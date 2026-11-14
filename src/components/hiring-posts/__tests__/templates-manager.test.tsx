import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { TemplatesManager } from '../templates-manager'
const push = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
const rows = [
  { id: 'qa', name: '원본 템플릿', blockCount: 5, updatedAt: '2026-09-27', isSample: false },
]
const sample = {
  id: 'sm',
  name: '기본 양식',
  blockCount: 2,
  updatedAt: '2026-09-01',
  isSample: true,
}
// 썸네일 GET 은 빈 블록으로 응답하고, 변경 요청(PATCH/DELETE)만 큐에서 꺼내 응답한다.
function mockFetch(...mutations: unknown[]) {
  const queue = [...mutations]
  global.fetch = jest.fn((_url: string, options?: { method?: string }) =>
    options?.method
      ? typeof queue[0] === 'function'
        ? (queue.shift() as () => Promise<unknown>)()
        : Promise.resolve(queue.shift())
      : Promise.resolve({ ok: true, json: async () => ({ contents: [] }) })
  ) as jest.Mock
}
const mutationCalls = () => (fetch as jest.Mock).mock.calls.filter(([, options]) => options?.method)
beforeEach(() => {
  jest.clearAllMocks()
  window.confirm = jest.fn(() => true)
})

it('이름 변경 중 입력·취소를 잠그고 성공 응답을 추가 목록 GET 없이 반영한다', async () => {
  let finish!: (value: unknown) => void
  mockFetch(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  render(<TemplatesManager initialTemplates={rows} />)
  fireEvent.click(screen.getByRole('button', { name: '원본 템플릿 이름 변경' }))
  fireEvent.change(screen.getByRole('textbox', { name: '템플릿 이름' }), {
    target: { value: '새 이름' },
  })
  fireEvent.click(screen.getByRole('button', { name: '이름 저장' }))
  expect(screen.getByRole('textbox', { name: '템플릿 이름' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '이름 변경 취소' })).toBeDisabled()
  await act(async () =>
    finish({
      ok: true,
      json: async () => ({ template: { id: 'qa', name: '새 이름', updatedAt: '2026-09-28' } }),
    })
  )
  expect(screen.getByText('새 이름')).toBeInTheDocument()
  expect(mutationCalls()).toHaveLength(1)
  expect(mutationCalls()[0][0]).toBe('/api/hiring-posts/templates/qa')
})

it('삭제 성공은 추가 조회 없이 목록에서 제거한다', async () => {
  mockFetch({ ok: true })
  render(<TemplatesManager initialTemplates={rows} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '원본 템플릿 삭제' })))
  expect(screen.queryByText('원본 템플릿')).not.toBeInTheDocument()
  expect(mutationCalls()).toHaveLength(1)
})

it('이름 저장 실패는 입력을 유지하고 재시도를 허용한다', async () => {
  mockFetch(
    { ok: false },
    {
      ok: true,
      json: async () => ({ template: { id: 'qa', name: '재시도', updatedAt: '2026-09-28' } }),
    }
  )
  render(<TemplatesManager initialTemplates={rows} />)
  fireEvent.click(screen.getByRole('button', { name: '원본 템플릿 이름 변경' }))
  fireEvent.change(screen.getByRole('textbox', { name: '템플릿 이름' }), {
    target: { value: '재시도' },
  })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '이름 저장' })))
  expect(screen.getByRole('textbox', { name: '템플릿 이름' })).toHaveValue('재시도')
  expect(screen.getByRole('button', { name: '이름 저장' })).toBeEnabled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '이름 저장' })))
  expect(screen.getByText('재시도')).toBeInTheDocument()
})

it('삭제 실패는 목록을 유지하고 다시 삭제할 수 있다', async () => {
  mockFetch({ ok: false }, { ok: true })
  render(<TemplatesManager initialTemplates={rows} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '원본 템플릿 삭제' })))
  expect(screen.getByText('원본 템플릿')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '원본 템플릿 삭제' })).toBeEnabled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '원본 템플릿 삭제' })))
  expect(screen.queryByText('원본 템플릿')).not.toBeInTheDocument()
})

it('워크덱 제공 탭은 읽기 전용(미리보기만)이고 내 템플릿 탭이 기본이다', async () => {
  mockFetch()
  render(<TemplatesManager initialTemplates={[...rows, sample]} />)
  expect(screen.getByRole('tab', { name: '내 템플릿 1' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: '워크덱 제공 1' })).toBeInTheDocument()
  await act(async () => {
    fireEvent.mouseDown(screen.getByRole('tab', { name: '워크덱 제공 1' }), { button: 0 })
  })
  expect(screen.getByText('기본 양식')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /이름 변경|삭제/ })).not.toBeInTheDocument()
  // 제공 카드: 내 템플릿으로 복사 + 새 공고 (복제 라벨은 없음)
  expect(screen.getByRole('button', { name: /내 템플릿으로 복사$/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '이 템플릿으로 새 공고' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /복제$/ })).not.toBeInTheDocument()
})

it('카드 미리보기는 큰 미리보기 대화상자를 열고 PC/모바일을 전환한다', async () => {
  mockFetch()
  render(<TemplatesManager initialTemplates={rows} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /미리보기$/ })))
  const dialog = await screen.findByRole('dialog', { name: '원본 템플릿' })
  const mobile = within(dialog).getByRole('button', { name: '모바일' })
  fireEvent.click(mobile)
  expect(mobile).toHaveAttribute('aria-pressed', 'true')
})

it('내 템플릿 카드는 복제·새 공고 버튼을 보이고 복제하면 새 카드가 목록에 추가된다', async () => {
  mockFetch({
    ok: true,
    json: async () => ({
      template: { id: 'cp', name: '원본 템플릿 (복사)', updatedAt: '2026-11-15', blockCount: 5 },
    }),
  })
  render(<TemplatesManager initialTemplates={rows} />)
  expect(screen.queryByRole('button', { name: /내 템플릿으로 복사$/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '이 템플릿으로 새 공고' })).toBeInTheDocument()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /복제$/ })))
  expect(screen.getByText('원본 템플릿 (복사)')).toBeInTheDocument()
  expect(mutationCalls()[0][0]).toBe('/api/hiring-posts/templates/qa/copy')
})

it('제공 템플릿 복사 성공 시 내 템플릿 탭으로 전환해 새 카드를 보여 준다', async () => {
  mockFetch({
    ok: true,
    json: async () => ({
      template: { id: 'cp', name: '기본 양식 (복사)', updatedAt: '2026-11-15', blockCount: 2 },
    }),
  })
  render(<TemplatesManager initialTemplates={[sample]} />)
  expect(screen.getByRole('tab', { name: '워크덱 제공 1' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: /내 템플릿으로 복사$/ }))
  )
  expect(screen.getByRole('tab', { name: '내 템플릿 1' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('기본 양식 (복사)')).toBeInTheDocument()
})

it('복사 실패는 목록을 바꾸지 않는다', async () => {
  mockFetch({ ok: false })
  render(<TemplatesManager initialTemplates={rows} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /복제$/ })))
  expect(screen.queryByText('원본 템플릿 (복사)')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /복제$/ })).toBeEnabled()
})

it('미리보기 대화상자 푸터에도 새 공고 버튼이 있다', async () => {
  mockFetch()
  render(<TemplatesManager initialTemplates={rows} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /미리보기$/ })))
  const dialog = await screen.findByRole('dialog', { name: '원본 템플릿' })
  expect(within(dialog).getByRole('button', { name: '이 템플릿으로 새 공고' })).toBeInTheDocument()
})
