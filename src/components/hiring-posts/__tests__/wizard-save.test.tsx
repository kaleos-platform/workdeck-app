import Link from 'next/link'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { BuildWizard } from '../build-wizard'
import type { WizardData } from '../build-types'

const push = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('../step-positions', () => ({ StepPositions: () => null }))
jest.mock('../application-form-preview', () => ({ ApplicationFormPreview: () => null }))
jest.mock('../posting-preview', () => ({ PostingPreview: () => null }))
jest.mock('../content-block-editor', () => ({ ContentBlockEditor: () => <div>본문 편집</div> }))

const data: WizardData = {
  posting: {
    id: 'qa',
    uuid: 'public',
    title: 'QA',
    status: 'DRAFT',
    closingDate: null,
    notificationEnabled: false,
    positions: [],
    storeIds: [],
    contents: [],
    formFields: [{ key: 'custom_qa', type: 'string', label: '기존 질문', required: false }],
    appliedTemplateId: null,
    appliedTemplateName: null,
    appliedTemplateAt: null,
  },
  spaceStores: [{ id: 'store-qa', name: 'QA 매장', roadAddress: null }],
  spacePositions: [],
}
beforeEach(() => {
  jest.clearAllMocks()
})

it('제목 저장 응답 전 이동을 기다리고 실패 시 제목을 유지해 재시도한다', async () => {
  let finish!: (value: unknown) => void
  global.fetch = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValue({ ok: true })
  render(<BuildWizard data={data} />)
  fireEvent.change(screen.getByLabelText('공고 제목'), { target: { value: '최신 제목' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ }))
  })
  expect(screen.getByLabelText('공고 제목')).toHaveValue('최신 제목')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status')).toHaveTextContent('변경사항을 저장하고 있습니다')
  await act(async () => {
    finish({ ok: false })
  })
  expect(screen.queryByText('변경사항을 저장하고 있습니다')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('제목 저장에 실패했습니다')
  expect(screen.getByLabelText('공고 제목').closest('[inert]')).toBeNull()
  expect(screen.getByLabelText('공고 제목')).toHaveValue('최신 제목')
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ }))
  })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByPlaceholderText('항목 이름')).toBeInTheDocument()
  expect(JSON.parse((fetch as jest.Mock).mock.calls[1][1].body)).toEqual({ title: '최신 제목' })
})

it('지원서 마지막 입력은 이동 전에 저장하고 실패 시 유지하며 재진입에도 보존한다', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
  render(<BuildWizard data={data} />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ }))
  })
  fireEvent.change(screen.getByPlaceholderText('항목 이름'), { target: { value: '최신 질문' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /공고 꾸미기/ }))
  })
  expect(screen.getByPlaceholderText('항목 이름')).toHaveValue('최신 질문')
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /공고 꾸미기/ }))
  })
  expect(screen.getByText('본문 편집')).toBeInTheDocument()
  const payload = JSON.parse((fetch as jest.Mock).mock.calls[1][1].body)
  expect(payload.fields).toEqual(
    expect.arrayContaining([expect.objectContaining({ label: '최신 질문' })])
  )
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ }))
  })
  expect(screen.getByPlaceholderText('항목 이름')).toHaveValue('최신 질문')
})

it('마감일 저장 실패 시 이동을 막고 최신 날짜로 재시도한다', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
  render(<BuildWizard data={data} />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ }))
  })
  fireEvent.change(screen.getByLabelText('지원서 마감일'), { target: { value: '2099-12-31' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /공고 꾸미기/ }))
  })
  expect(screen.getByLabelText('지원서 마감일')).toHaveValue('2099-12-31')
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /공고 꾸미기/ }))
  })
  expect(screen.getByText('본문 편집')).toBeInTheDocument()
  expect(JSON.parse((fetch as jest.Mock).mock.calls[1][1].body)).toEqual({
    closingDate: '2099-12-31',
    notificationEnabled: false,
  })
})

it('매장 선택 직후 이동해도 저장 실패 시 선택을 유지하고 재시도한다', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
  render(<BuildWizard data={data} />)
  fireEvent.click(screen.getByRole('checkbox', { name: 'QA 매장' }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ }))
  })
  expect(screen.getByRole('checkbox', { name: 'QA 매장' })).toBeChecked()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ }))
  })
  expect(screen.getByLabelText('지원서 마감일')).toBeInTheDocument()
  expect(JSON.parse((fetch as jest.Mock).mock.calls[1][1].body)).toEqual({ storeIds: ['store-qa'] })
})

it('매장 생성 후 연결 실패는 매장을 재생성하지 않고 연결만 재시도한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ store: { id: 'new-store', name: '새 QA 매장', roadAddress: null } }),
    })
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValue({ ok: true })
  render(<BuildWizard data={data} />)
  fireEvent.click(screen.getByRole('button', { name: '매장 추가' }))
  fireEvent.change(screen.getByLabelText('매장명'), { target: { value: '새 QA 매장' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^추가$/ }))
  })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '새 QA 매장' })).toBeChecked()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ }))
  })
  expect((fetch as jest.Mock).mock.calls.map((call) => call[1].method)).toEqual([
    'POST',
    'PUT',
    'PUT',
  ])
  expect(JSON.parse((fetch as jest.Mock).mock.calls[2][1].body)).toEqual({
    storeIds: ['new-store'],
  })
})

it('마감일 저장 중 추가 변경도 순서대로 저장한다', async () => {
  let finish!: (value: unknown) => void
  global.fetch = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValue({ ok: true })
  render(<BuildWizard data={data} />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ }))
  })
  const date = screen.getByLabelText('지원서 마감일')
  fireEvent.change(date, { target: { value: '2099-12-30' } })
  fireEvent.blur(date)
  fireEvent.change(date, { target: { value: '2099-12-31' } })
  fireEvent.blur(date)
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => {
    finish({ ok: true })
  })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(JSON.parse((fetch as jest.Mock).mock.calls[1][1].body).closingDate).toBe('2099-12-31')
})

it('새로 입력한 과거 마감일은 이동과 저장을 막는다', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true })
  render(<BuildWizard data={data} />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ }))
  })
  fireEvent.change(screen.getByLabelText('지원서 마감일'), { target: { value: '2000-01-01' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /공고 꾸미기/ }))
  })
  expect(screen.getByLabelText('지원서 마감일')).toHaveValue('2000-01-01')
  expect(fetch).not.toHaveBeenCalled()
})

it('기존 지원서 이름을 비우면 자동 저장으로 삭제하지 않고 이동을 막는다', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true })
  render(<BuildWizard data={data} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ })))
  fireEvent.change(screen.getByPlaceholderText('항목 이름'), { target: { value: '   ' } })
  fireEvent.blur(screen.getByPlaceholderText('항목 이름'))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /공고 꾸미기/ })))
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.getByPlaceholderText('항목 이름')).toHaveValue('   ')
  expect(screen.getByText('항목 이름을 입력하거나 항목을 삭제하세요.')).toBeInTheDocument()
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  fireEvent.change(screen.getByPlaceholderText('항목 이름'), { target: { value: '수정한 질문' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /공고 꾸미기/ })))
  expect(screen.getByText('본문 편집')).toBeInTheDocument()
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body).fields).toEqual(
    expect.arrayContaining([expect.objectContaining({ key: 'custom_qa', label: '수정한 질문' })])
  )
})

it('새 빈 지원서 항목은 명시적으로 삭제한 후 이동할 수 있다', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true })
  render(<BuildWizard data={data} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ })))
  fireEvent.click(screen.getByRole('button', { name: '항목 추가' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /공고 꾸미기/ })))
  expect(screen.getAllByPlaceholderText('항목 이름')).toHaveLength(2)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '빈 항목 삭제' })))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /공고 꾸미기/ })))
  expect(screen.getByText('본문 편집')).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

it('브라우저 뒤로가기는 마지막 입력 저장 응답 후 원래 history 항목으로 이동한다', async () => {
  const navigation = new EventTarget()
  const traverseTo = jest.fn((key: string) => {
    const resumed = new Event('navigate', { cancelable: true })
    Object.assign(resumed, {
      navigationType: 'traverse',
      destination: { key, url: 'http://localhost/previous' },
    })
    navigation.dispatchEvent(resumed)
    expect(resumed.defaultPrevented).toBe(false)
    return { finished: Promise.resolve() }
  })
  Object.assign(navigation, { traverseTo })
  Object.defineProperty(window, 'navigation', { value: navigation, configurable: true })
  let finish!: (value: unknown) => void
  global.fetch = jest.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const { unmount } = render(<BuildWizard data={data} />)
  fireEvent.change(screen.getByLabelText('공고 제목'), { target: { value: '뒤로가기 저장' } })
  const event = new Event('navigate', { cancelable: true })
  Object.assign(event, {
    navigationType: 'traverse',
    destination: { key: 'previous', url: 'http://localhost/d/recruiting/postings/qa' },
  })
  await act(async () => {
    navigation.dispatchEvent(event)
  })
  expect(event.defaultPrevented).toBe(true)
  expect(traverseTo).not.toHaveBeenCalled()
  await act(async () => finish({ ok: true }))
  expect(traverseTo).toHaveBeenCalledWith('previous')
  unmount()
  const afterUnmount = new Event('navigate', { cancelable: true })
  Object.assign(afterUnmount, {
    navigationType: 'traverse',
    destination: { key: 'another', url: 'http://localhost/another' },
  })
  navigation.dispatchEvent(afterUnmount)
  expect(afterUnmount.defaultPrevented).toBe(false)
  Reflect.deleteProperty(window, 'navigation')
})

it('뒤로가기 저장 실패는 현재 화면을 유지하고 다시 시도할 수 있다', async () => {
  const navigation = new EventTarget()
  const traverseTo = jest.fn().mockReturnValue({ finished: Promise.resolve() })
  Object.assign(navigation, { traverseTo })
  Object.defineProperty(window, 'navigation', { value: navigation, configurable: true })
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
  const { unmount } = render(<BuildWizard data={data} />)
  fireEvent.change(screen.getByLabelText('공고 제목'), { target: { value: '실패 후 재시도' } })
  function back() {
    const event = new Event('navigate', { cancelable: true })
    Object.assign(event, {
      navigationType: 'traverse',
      destination: { key: 'previous', url: 'http://localhost/previous' },
    })
    navigation.dispatchEvent(event)
  }
  await act(async () => back())
  expect(traverseTo).not.toHaveBeenCalled()
  expect(screen.getByLabelText('공고 제목')).toHaveValue('실패 후 재시도')
  await act(async () => back())
  expect(traverseTo).toHaveBeenCalledTimes(1)
  unmount()
  Reflect.deleteProperty(window, 'navigation')
})

it('사이드바 링크도 빈 지원서 항목이 있으면 이동하지 않는다', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true })
  render(
    <>
      <Link href="/d/recruiting/home">사이드바 홈</Link>
      <BuildWizard data={data} />
    </>
  )
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ })))
  fireEvent.click(screen.getByRole('button', { name: '항목 추가' }))
  await act(async () => fireEvent.click(screen.getByRole('link', { name: '사이드바 홈' })))
  expect(push).not.toHaveBeenCalled()
  expect(screen.getAllByPlaceholderText('항목 이름')).toHaveLength(2)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '빈 항목 삭제' })))
  await act(async () => fireEvent.click(screen.getByRole('link', { name: '사이드바 홈' })))
  expect(push).toHaveBeenCalledWith('/d/recruiting/home')
})

it('빈 이름의 blur 자동 저장도 기존 서버 항목을 삭제하지 않는다', async () => {
  jest.useFakeTimers()
  global.fetch = jest.fn().mockResolvedValue({ ok: true })
  const { unmount } = render(<BuildWizard data={data} />)
  try {
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ })))
    fireEvent.change(screen.getByPlaceholderText('항목 이름'), { target: { value: '' } })
    fireEvent.blur(screen.getByPlaceholderText('항목 이름'))
    await act(async () => jest.advanceTimersByTime(700))
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('항목 이름')).toHaveValue('')
  } finally {
    unmount()
    jest.useRealTimers()
  }
})

it('보조 지원서 설정에서 빈 항목은 복귀를 막고 삭제 후 공고 꾸미기로 돌아간다', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true })
  render(<BuildWizard data={data} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /지원서 설정/ })))
  fireEvent.click(screen.getByRole('button', { name: '항목 추가' }))
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: '설정 저장하고 돌아가기' }))
  )
  expect(screen.getByRole('button', { name: '빈 항목 삭제' })).toBeInTheDocument()
  expect(screen.queryByText('본문 편집')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '빈 항목 삭제' }))
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: '설정 저장하고 돌아가기' }))
  )
  expect(screen.getByText('본문 편집')).toBeInTheDocument()
})
