import { act, fireEvent, render, screen } from '@testing-library/react'
import { ApplyForm } from '@/components/hiring-public/apply-form'

const sessionUrl = '/api/hiring-public/upload-sessions'
const completeUrl = `${sessionUrl}/complete`
const file = new File(['resume'], 'resume.pdf', { type: 'application/pdf' })
const response = (status = 200, body = {}) => ({ ok: status < 400, status, json: async () => body })
const session = (id = 'session-1', expiresAt = new Date(Date.now() + 60_000).toISOString()) =>
  response(200, {
    uploadSessionId: id,
    uploadToken: `token-${id}`,
    expiresAt,
    uploads: [{ url: `https://storage.test/${id}`, fieldKey: 'a', fileName: file.name }],
  })

function setup() {
  const rendered = render(
    <ApplyForm
      postingUuid="qa"
      fields={[
        { key: 'a', type: 'file', label: '자료', required: true, maxFileCount: 2, maxFileSize: 10 },
        { key: 'note', type: 'text', label: '메모', required: false },
      ]}
      positions={[]}
      stores={[]}
    />
  )
  const input = screen.getByLabelText('자료', { exact: false })
  fireEvent.change(input, { target: { files: [file] } })
  fireEvent.click(screen.getByRole('checkbox'))
  return {
    input,
    submit: () =>
      act(async () => {
        fireEvent.submit(rendered.container.querySelector('form')!)
      }),
  }
}

afterEach(() => jest.restoreAllMocks())

it('복수 파일을 보존하고 개별 제거 후 signed URL로 원본 파일과 manifest를 제출한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(session())
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response())
  const { input, submit } = setup()
  expect(input).toHaveAttribute('multiple')
  fireEvent.change(input, { target: { files: [new File(['2'], 'two.pdf')] } })
  expect(screen.getByText('two.pdf')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '자료 two.pdf 첨부 제거' }))
  expect(screen.queryByText('two.pdf')).not.toBeInTheDocument()
  await submit()
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    'https://storage.test/session-1',
    expect.objectContaining({ method: 'PUT', body: file })
  )
  const calls = (fetch as jest.Mock).mock.calls
  expect(JSON.parse(calls[0][1].body).files).toEqual([
    { fieldKey: 'a', fileName: file.name, mimeType: file.type, sizeBytes: file.size },
  ])
  expect(calls[2][0]).toBe(completeUrl)
  expect(JSON.parse(calls[2][1].body)).toMatchObject({
    fileFieldKeys: ['a'],
    uploadSessionId: 'session-1',
    uploadToken: 'token-session-1',
  })
  expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument()
})

it('최종 저장 실패 후 같은 파일은 업로드 없이 기존 세션으로 재시도한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(session())
    .mockResolvedValueOnce(response(409))
    .mockResolvedValueOnce(response(500, { message: '저장 실패' }))
    .mockResolvedValueOnce(response())
  const { submit } = setup()
  await submit()
  expect(screen.getByText('저장 실패')).toBeInTheDocument()
  await submit()
  expect((fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
    sessionUrl,
    'https://storage.test/session-1',
    completeUrl,
    completeUrl,
  ])
  expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument()
})

it.each(['gone', 'changed'])('%s 세션은 재사용하지 않고 새로 업로드한다', async (reason) => {
  const now = Date.now()
  jest.spyOn(Date, 'now').mockReturnValue(now)
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(session('session-1', new Date(now + 1000).toISOString()))
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response(reason === 'gone' ? 410 : 400, { message: '다시 제출' }))
    .mockResolvedValueOnce(session('session-2'))
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response())
  const { submit } = setup()
  await submit()
  if (reason === 'changed') {
    fireEvent.click(screen.getByRole('button', { name: '자료 resume.pdf 첨부 제거' }))
    fireEvent.change(screen.getByLabelText('자료', { exact: false }), {
      target: { files: [new File(['new'], file.name, { type: file.type })] },
    })
  }
  await submit()
  expect((fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
    sessionUrl,
    'https://storage.test/session-1',
    completeUrl,
    sessionUrl,
    'https://storage.test/session-2',
    completeUrl,
  ])
})

it('제출 중에는 첨부 추가와 제거를 잠근다', async () => {
  let finish!: (value: ReturnType<typeof response>) => void
  global.fetch = jest.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const { input, submit } = setup()
  await submit()
  expect(input).toBeDisabled()
  const remove = screen.getByRole('button', { name: '자료 resume.pdf 첨부 제거' })
  expect(remove).toBeDisabled()
  fireEvent.click(remove)
  expect(screen.getByText('resume.pdf')).toBeInTheDocument()
  await act(async () => finish(response(500, { message: '준비 실패' })))
  expect(input).not.toBeDisabled()
  expect(remove).not.toBeDisabled()
})

it('업로드 응답 유실 뒤 세션이 만료되면 완료 API로 상태를 확인한다', async () => {
  const now = Date.now()
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now)
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(session('session-1', new Date(now + 1000).toISOString()))
    .mockRejectedValueOnce(new Error('응답 유실'))
    .mockResolvedValueOnce(response())
  const { submit } = setup()
  await submit()
  clock.mockReturnValue(now + 1001)
  await submit()
  expect((fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
    sessionUrl,
    'https://storage.test/session-1',
    completeUrl,
  ])
  expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument()
})

it.each([
  ['Duplicate', 400],
  ['Asset Already Exists', 400],
  ['Other failure', 400],
])('업로드 응답 유실 후 %s 응답을 구분한다', async (message, status) => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(session())
    .mockRejectedValueOnce(new Error('응답 유실'))
    .mockResolvedValueOnce(response(status as number, { error: message }))
    .mockResolvedValueOnce(response())
  const { submit } = setup()
  await submit()
  await submit()
  if (message === 'Other failure') {
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(screen.queryByText('지원이 완료되었습니다')).not.toBeInTheDocument()
  } else {
    expect((fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
      sessionUrl,
      'https://storage.test/session-1',
      'https://storage.test/session-1',
      completeUrl,
    ])
    expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument()
  }
})

it('최종 완료 응답 유실 후 만료되어도 새 지원을 만들지 않는다', async () => {
  const now = Date.now()
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now)
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(session('session-1', new Date(now + 1000).toISOString()))
    .mockResolvedValueOnce(response())
    .mockRejectedValueOnce(new Error('응답 유실'))
    .mockResolvedValueOnce(response())
  const { submit } = setup()
  await submit()
  clock.mockReturnValue(now + 1001)
  await submit()
  expect((fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
    sessionUrl,
    'https://storage.test/session-1',
    completeUrl,
    completeUrl,
  ])
  expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument()
})

it.each(['network', 'server', 'conflict'])(
  '완료 %s 오류 뒤 파일 변경 시 이전 요청 그대로 확인한다',
  async (failure) => {
    const mock = jest.fn().mockResolvedValueOnce(session()).mockResolvedValueOnce(response())
    if (failure === 'network') mock.mockRejectedValueOnce(new Error('응답 유실'))
    else
      mock.mockResolvedValueOnce(
        response(failure === 'server' ? 500 : 409, { message: '저장 불확실' })
      )
    global.fetch = mock.mockResolvedValueOnce(response())
    const { submit } = setup()
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '기존 입력' } })
    await submit()
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '수정 입력' } })
    fireEvent.click(screen.getByRole('button', { name: '자료 resume.pdf 첨부 제거' }))
    fireEvent.change(screen.getByLabelText('자료', { exact: false }), {
      target: { files: [new File(['new'], 'changed.pdf', { type: file.type })] },
    })
    await submit()
    expect(mock.mock.calls.map(([url]) => url)).toEqual([
      sessionUrl,
      'https://storage.test/session-1',
      completeUrl,
      completeUrl,
    ])
    expect(mock.mock.calls[3][1].body).toBe(mock.mock.calls[2][1].body)
    expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument()
  }
)

it('불확실한 완료를 확인하다 410이면 현재 클릭에서는 새 세션을 만들지 않는다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(session())
    .mockResolvedValueOnce(response())
    .mockRejectedValueOnce(new Error('응답 유실'))
    .mockResolvedValueOnce(response(410, { message: '만료' }))
    .mockResolvedValueOnce(session('session-2'))
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response())
  const { submit } = setup()
  await submit()
  await submit()
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(screen.getByText('만료')).toBeInTheDocument()
  await submit()
  expect((fetch as jest.Mock).mock.calls[4][0]).toBe(sessionUrl)
  expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument()
})

it.each([400, 422])(
  '이전 요청 확인이 %s로 거절되면 다음 클릭에서 수정 입력을 제출한다',
  async (status) => {
    const mock = jest
      .fn()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new Error('응답 유실'))
      .mockResolvedValueOnce(response(status, { message: '입력 수정 필요' }))
      .mockResolvedValueOnce(response())
    global.fetch = mock
    const { submit } = setup()
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '기존 입력' } })
    await submit()
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '수정 입력' } })
    await submit()
    expect(mock).toHaveBeenCalledTimes(4)
    expect(mock.mock.calls[3][1].body).toBe(mock.mock.calls[2][1].body)
    expect(screen.getByText('입력 수정 필요')).toBeInTheDocument()
    await submit()
    expect(mock.mock.calls[4][0]).toBe(completeUrl)
    expect(JSON.parse(mock.mock.calls[4][1].body).entries).toContainEqual(
      expect.objectContaining({ key: 'note', value: '수정 입력' })
    )
    expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument()
  }
)
