import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApplyForm } from '@/components/hiring-public/apply-form'
import { verifyRecovery } from '@/lib/hiring/recovery-client'

jest.mock('@/lib/hiring/recovery-client', () => ({
  verifyRecovery: jest.fn().mockResolvedValue(true),
}))

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

afterEach(() => {
  jest.restoreAllMocks()
  sessionStorage.clear()
})

it('새로 열린 화면에서 이전 제출 완료를 확인한다', async () => {
  sessionStorage.setItem('hiring-recovery:qa', 'session-1')
  global.fetch = jest.fn().mockResolvedValue(response(200, { status: 'completed' }))
  render(<ApplyForm postingUuid="qa" fields={[]} positions={[]} stores={[]} />)
  fireEvent.click(screen.getByRole('button', { name: '이전 제출 결과 확인' }))
  await waitFor(() => expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument())
  expect(sessionStorage.getItem('hiring-recovery:qa')).toBeNull()
})

it('이전 제출 결과를 확인할 수 없으면 새 제출을 막는다', async () => {
  sessionStorage.setItem('hiring-recovery:qa', 'session-1')
  global.fetch = jest.fn().mockRejectedValue(new Error('연결 오류'))
  render(<ApplyForm postingUuid="qa" fields={[]} positions={[]} stores={[]} />)
  fireEvent.click(screen.getByRole('button', { name: '이전 제출 결과 확인' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '이전 제출 결과 다시 확인' })).toBeEnabled()
  )
  expect(screen.queryByRole('button', { name: '지원서 제출' })).not.toBeInTheDocument()
  expect(sessionStorage.getItem('hiring-recovery:qa')).toBe('session-1')
})

it('결과를 확인할 수 없을 때 중복 가능성을 확인한 뒤 다시 작성할 수 있다', async () => {
  sessionStorage.setItem('hiring-recovery:qa', 'session-1')
  global.fetch = jest.fn().mockRejectedValue(new Error('연결 오류'))
  const confirm = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  render(<ApplyForm postingUuid="qa" fields={[]} positions={[]} stores={[]} />)
  fireEvent.click(screen.getByRole('button', { name: '이전 제출 결과 확인' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '결과 확인 없이 다시 작성' })).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: '결과 확인 없이 다시 작성' }))
  expect(sessionStorage.getItem('hiring-recovery:qa')).toBe('session-1')
  fireEvent.click(screen.getByRole('button', { name: '결과 확인 없이 다시 작성' }))
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(sessionStorage.getItem('hiring-recovery:qa')).toBeNull()
  expect(screen.getByRole('button', { name: '지원서 제출' })).toBeEnabled()
})

it('완료 응답 유실 후 다시 열면 이전 세션만 확인하고 새 제출은 만들지 않는다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(session())
    .mockRejectedValueOnce(new Error('응답 유실'))
    .mockResolvedValueOnce(response(200, { status: 'completed' }))
  let rendered = render(<ApplyForm postingUuid="qa" fields={[]} positions={[]} stores={[]} />)
  fireEvent.click(screen.getByRole('checkbox'))
  await act(async () => {
    fireEvent.submit(rendered.container.querySelector('form')!)
  })
  expect(sessionStorage.getItem('hiring-recovery:qa')).toBe('session-1')
  rendered.unmount()
  rendered = render(<ApplyForm postingUuid="qa" fields={[]} positions={[]} stores={[]} />)
  expect(fetch).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: '이전 제출 결과 확인' }))
  await waitFor(() => expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument())
  expect((fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
    sessionUrl,
    completeUrl,
    '/api/hiring-public/upload-sessions/recover/session-1',
  ])
  rendered.unmount()
})

it('이전 제출이 취소된 경우 다시 작성할 수 있다', async () => {
  sessionStorage.setItem('hiring-recovery:qa', 'session-1')
  global.fetch = jest.fn().mockResolvedValue(response(200, { status: 'cancelled' }))
  render(<ApplyForm postingUuid="qa" fields={[]} positions={[]} stores={[]} />)
  fireEvent.click(screen.getByRole('button', { name: '이전 제출 결과 확인' }))
  await waitFor(() =>
    expect(screen.getByText(/이전 제출은 완료되지 않았습니다/)).toBeInTheDocument()
  )
  expect(screen.getByRole('button', { name: '지원서 제출' })).toBeEnabled()
  expect(sessionStorage.getItem('hiring-recovery:qa')).toBeNull()
})

it('브라우저 저장소에 복구 식별자를 기록할 수 없으면 최종 제출을 보내지 않는다', async () => {
  global.fetch = jest.fn().mockResolvedValue(session())
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  const rendered = render(<ApplyForm postingUuid="qa" fields={[]} positions={[]} stores={[]} />)
  fireEvent.click(screen.getByRole('checkbox'))
  await act(async () => {
    fireEvent.submit(rendered.container.querySelector('form')!)
  })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/브라우저 저장소/)).toBeInTheDocument()
})
it('복구 쿠키가 차단되면 최종 제출을 보내지 않는다', async () => {
  ;(verifyRecovery as jest.Mock).mockResolvedValueOnce(false)
  global.fetch = jest.fn().mockResolvedValue(session())
  const rendered = render(<ApplyForm postingUuid="qa" fields={[]} positions={[]} stores={[]} />)
  fireEvent.click(screen.getByRole('checkbox'))
  await act(async () => {
    fireEvent.submit(rendered.container.querySelector('form')!)
  })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/브라우저 쿠키/)).toBeInTheDocument()
})
it('복구 쿠키 확인 전에 세션이 만료되면 다음 시도에 새 세션을 준비한다', async () => {
  const now = Date.now()
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now)
  ;(verifyRecovery as jest.Mock)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(false)
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(session('session-1', new Date(now + 1000).toISOString()))
    .mockResolvedValueOnce(session('session-2', new Date(now + 60000).toISOString()))
  const rendered = render(<ApplyForm postingUuid="qa" fields={[]} positions={[]} stores={[]} />)
  fireEvent.click(screen.getByRole('checkbox'))
  const submit = () =>
    act(async () => {
      fireEvent.submit(rendered.container.querySelector('form')!)
    })
  await submit()
  clock.mockReturnValue(now + 2000)
  await submit()
  await submit()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('제출 중과 결과가 불확실한 동안 이탈을 경고하고 확인 후 해제한다', async () => {
  let finish!: (value: ReturnType<typeof response>) => void
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(session())
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValueOnce(response())
  const rendered = render(<ApplyForm postingUuid="qa" fields={[]} positions={[]} stores={[]} />)
  const leaving = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  expect(leaving()).toBe(false)
  fireEvent.click(screen.getByRole('checkbox'))
  const submit = () =>
    act(async () => {
      fireEvent.submit(rendered.container.querySelector('form')!)
    })
  await submit()
  expect(leaving()).toBe(true)
  await act(async () => {
    finish(response(500))
  })
  expect(leaving()).toBe(true)
  await submit()
  expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument()
  expect(leaving()).toBe(false)
})

it('첨부 없는 제출은 파일 업로드 대신 지원서 준비와 저장을 안내한다', async () => {
  let finishIntent!: (value: ReturnType<typeof response>) => void
  let finishComplete!: (value: ReturnType<typeof response>) => void
  global.fetch = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishIntent = resolve
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishComplete = resolve
        })
    )
  const rendered = render(<ApplyForm postingUuid="qa" fields={[]} positions={[]} stores={[]} />)
  fireEvent.click(screen.getByRole('checkbox'))
  await act(async () => {
    fireEvent.submit(rendered.container.querySelector('form')!)
  })
  expect(screen.getByRole('status')).toHaveTextContent('지원서 제출 준비 중')
  await act(async () => {
    finishIntent(session())
  })
  expect(screen.getByRole('status')).toHaveTextContent('지원서 저장 중')
  await act(async () => {
    finishComplete(response())
  })
  expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument()
})

it('첨부 없이 제출한 응답이 유실되면 기존 접수 결과를 재확인한다', async () => {
  let attempted = false
  global.fetch = jest.fn(async (url) => {
    if (url === sessionUrl) return session()
    if (!attempted) {
      attempted = true
      throw new Error('응답 유실')
    }
    return response()
  }) as jest.Mock
  const rendered = render(<ApplyForm postingUuid="qa" fields={[]} positions={[]} stores={[]} />)
  fireEvent.click(screen.getByRole('checkbox'))
  const submit = () =>
    act(async () => {
      fireEvent.submit(rendered.container.querySelector('form')!)
    })
  await submit()
  await submit()
  const calls = (fetch as jest.Mock).mock.calls
  expect(calls.map(([url]) => url)).toEqual([sessionUrl, completeUrl, completeUrl])
  expect(JSON.parse(calls[0][1].body).files).toEqual([])
  expect(calls[1][1].body).toBe(calls[2][1].body)
  expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument()
})

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
  expect(screen.getByLabelText('메모')).toBeDisabled()
  expect(screen.getByRole('checkbox')).toBeDisabled()
  const remove = screen.getByRole('button', { name: '자료 resume.pdf 첨부 제거' })
  expect(remove).toBeDisabled()
  fireEvent.click(remove)
  expect(screen.getByText('resume.pdf')).toBeInTheDocument()
  await act(async () => finish(response(500, { message: '준비 실패' })))
  expect(input).not.toBeDisabled()
  expect(remove).not.toBeDisabled()
  expect(screen.getByLabelText('메모')).not.toBeDisabled()
})

it('제출 결과가 불확실하면 이전 입력으로 재확인됨을 안내한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(session())
    .mockResolvedValueOnce(response())
    .mockRejectedValueOnce(new Error('연결 오류'))
    .mockResolvedValueOnce(response(400, { message: '입력을 확인하세요' }))
  const { submit } = setup()
  await submit()
  expect(screen.getByText(/이전에 제출한 내용으로 결과를 확인/)).toBeInTheDocument()
  expect(screen.getByText(/수정한 내용은 반영되지 않을 수 있습니다/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '이전 제출 결과 확인' })).toBeEnabled()
  await submit()
  expect(screen.queryByText(/이전에 제출한 내용으로 결과를 확인/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '이전 제출 결과 확인' })).toBeEnabled()
})

it('업로드 응답 유실 후 세션이 만료되면 새 세션으로 업로드한다', async () => {
  const now = Date.now()
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now)
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(session('session-1', new Date(now + 1000).toISOString()))
    .mockRejectedValueOnce(new Error('응답 유실'))
    .mockResolvedValueOnce(session('session-2', new Date(now + 60000).toISOString()))
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response())
  const { submit } = setup()
  await submit()
  clock.mockReturnValue(now + 1001)
  await submit()
  expect((fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
    sessionUrl,
    'https://storage.test/session-1',
    sessionUrl,
    'https://storage.test/session-2',
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

it('불확실한 완료를 확인하다 410이면 이전 세션의 결과를 다시 확인한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(session())
    .mockResolvedValueOnce(response())
    .mockRejectedValueOnce(new Error('응답 유실'))
    .mockResolvedValueOnce(response(410, { message: '만료' }))
    .mockResolvedValueOnce(response(200, { status: 'completed' }))
  const { submit } = setup()
  await submit()
  await submit()
  expect(fetch).toHaveBeenCalledTimes(4)
  fireEvent.click(screen.getByRole('button', { name: '이전 제출 결과 확인' }))
  await waitFor(() => expect(screen.getByText('지원이 완료되었습니다')).toBeInTheDocument())
  expect((fetch as jest.Mock).mock.calls[4][0]).toBe(
    '/api/hiring-public/upload-sessions/recover/session-1'
  )
})

it.each([400, 422])(
  '이전 요청 확인이 %s로 거절되어도 기존 결과를 먼저 확인한다',
  async (status) => {
    const mock = jest
      .fn()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new Error('응답 유실'))
      .mockResolvedValueOnce(response(status, { message: '입력 수정 필요' }))
      .mockResolvedValueOnce(response(200, { status: 'cancelled' }))
    global.fetch = mock
    const { submit } = setup()
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '기존 입력' } })
    await submit()
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '수정 입력' } })
    await submit()
    expect(mock).toHaveBeenCalledTimes(4)
    expect(mock.mock.calls[3][1].body).toBe(mock.mock.calls[2][1].body)
    fireEvent.click(screen.getByRole('button', { name: '이전 제출 결과 확인' }))
    await waitFor(() =>
      expect(screen.getByText(/이전 제출은 완료되지 않았습니다/)).toBeInTheDocument()
    )
    expect(mock.mock.calls[4][0]).toBe('/api/hiring-public/upload-sessions/recover/session-1')
  }
)
