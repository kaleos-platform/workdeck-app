import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NewPostingButton } from '../new-posting-button'
import { toast } from 'sonner'
import { PostingsTable } from '../postings-table'

const push = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn()
})

it('제목을 입력한 뒤 초안을 생성하고 편집 화면으로 이동한다', async () => {
  ;(fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ posting: { id: 'qa' } }),
  })
  render(
    <PostingsTable
      postings={[]}
      total={0}
      page={1}
      pageSize={50}
      q=""
      status="ALL"
      store=""
      position=""
      jobType=""
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '새 공고' }))
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('공고 제목'), { target: { value: '  강남점 채용  ' } })
  fireEvent.click(screen.getByRole('button', { name: '공고 만들기' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/d/recruiting/postings/qa/build'))
  expect(fetch).toHaveBeenCalledWith(
    '/api/hiring-posts/postings',
    expect.objectContaining({ body: JSON.stringify({ title: '강남점 채용' }) })
  )
})

it('공백 제목은 제출하지 않고 실패 시 입력을 유지해 재시도한다', async () => {
  ;(fetch as jest.Mock).mockResolvedValue({ ok: false })
  render(
    <PostingsTable
      postings={[]}
      total={0}
      page={1}
      pageSize={50}
      q=""
      status="ALL"
      store=""
      position=""
      jobType=""
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '새 공고' }))
  const title = screen.getByLabelText('공고 제목')
  fireEvent.change(title, { target: { value: '   ' } })
  expect(screen.getByRole('button', { name: '공고 만들기' })).toBeDisabled()
  fireEvent.change(title, { target: { value: '재시도 공고' } })
  fireEvent.click(screen.getByRole('button', { name: '공고 만들기' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '공고 만들기' })).toBeEnabled())
  expect(title).toHaveValue('재시도 공고')
  expect(push).not.toHaveBeenCalled()
})

it('생성 응답을 기다리는 동안 중복 제출과 닫기를 막는다', async () => {
  let resolve!: (value: unknown) => void
  ;(fetch as jest.Mock).mockReturnValue(
    new Promise((done) => {
      resolve = done
    })
  )
  render(
    <PostingsTable
      postings={[]}
      total={0}
      page={1}
      pageSize={50}
      q=""
      status="ALL"
      store=""
      position=""
      jobType=""
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '새 공고' }))
  fireEvent.change(screen.getByLabelText('공고 제목'), { target: { value: '중복 방지' } })
  const form = screen.getByRole('button', { name: '공고 만들기' }).closest('form')!
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '취소' })).toBeDisabled()
  expect(screen.getByLabelText('공고 제목')).toBeDisabled()
  resolve({ ok: false })
  await waitFor(() => expect(screen.getByRole('button', { name: '공고 만들기' })).toBeEnabled())
})

it('이전 공고 복사 모드는 최근 10개를 보여주고 복사 API 후 편집 화면으로 이동한다', async () => {
  const postings = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    title: `공고 ${i}`,
    status: 'ACTIVE',
    createdAt: '2026-11-01T00:00:00.000Z',
  }))
  ;(fetch as jest.Mock).mockImplementation(async (url: string, options?: { method?: string }) => {
    if (url === '/api/hiring-posts/postings' && !options?.method)
      return { ok: true, json: async () => ({ postings }) }
    if (url === '/api/hiring-posts/postings/p3/copy')
      return { ok: true, json: async () => ({ posting: { id: 'copied' } }) }
    return { ok: false }
  })
  render(<NewPostingButton />)
  fireEvent.click(screen.getByRole('button', { name: '새 공고' }))
  fireEvent.click(screen.getByRole('button', { name: '이전 공고 복사해서 시작' }))
  const radios = await screen.findAllByRole('radio')
  expect(radios).toHaveLength(10)
  expect(screen.queryByText('공고 10')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '복사해서 시작' })).toBeDisabled()
  fireEvent.click(screen.getByRole('radio', { name: /공고 3/ }))
  fireEvent.click(screen.getByRole('button', { name: '복사해서 시작' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/d/recruiting/postings/copied/build'))
  expect(fetch).toHaveBeenCalledWith('/api/hiring-posts/postings/p3/copy', { method: 'POST' })
  expect(fetch).not.toHaveBeenCalledWith(
    '/api/hiring-posts/postings',
    expect.objectContaining({ method: 'POST' })
  )
})

it('복사 실패 시 이동하지 않고 다시 시도할 수 있다', async () => {
  ;(fetch as jest.Mock).mockImplementation(async (url: string) =>
    url === '/api/hiring-posts/postings'
      ? {
          ok: true,
          json: async () => ({
            postings: [{ id: 'p1', title: '강남', status: 'ACTIVE', createdAt: '2026-11-01' }],
          }),
        }
      : { ok: false }
  )
  render(<NewPostingButton />)
  fireEvent.click(screen.getByRole('button', { name: '새 공고' }))
  fireEvent.click(screen.getByRole('button', { name: '이전 공고 복사해서 시작' }))
  fireEvent.click(await screen.findByRole('radio'))
  fireEvent.click(screen.getByRole('button', { name: '복사해서 시작' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '복사해서 시작' })).toBeEnabled())
  expect(push).not.toHaveBeenCalled()
})

describe('템플릿으로 새 공고', () => {
  const template = { id: 'tpl', name: '카페 양식' }
  const open = () => {
    render(<NewPostingButton template={template} triggerLabel="이 템플릿으로 새 공고" />)
    fireEvent.click(screen.getByRole('button', { name: '이 템플릿으로 새 공고' }))
    fireEvent.change(screen.getByLabelText('공고 제목'), { target: { value: '홍대점' } })
    fireEvent.click(screen.getByRole('button', { name: '공고 만들기' }))
  }

  it('다이얼로그에 템플릿 이름이 보이고 복사 모드는 숨긴다', () => {
    render(<NewPostingButton template={template} triggerLabel="이 템플릿으로 새 공고" />)
    fireEvent.click(screen.getByRole('button', { name: '이 템플릿으로 새 공고' }))
    expect(screen.getByRole('dialog', { name: '이 템플릿으로 새 공고' })).toBeInTheDocument()
    expect(screen.getByText(/카페 양식/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '이전 공고 복사해서 시작' })
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('공고 제목')).toHaveValue('')
  })

  it('공고 생성 → 템플릿 append 적용 → 편집 화면으로 이동한다', async () => {
    ;(fetch as jest.Mock).mockImplementation(async (url: string) =>
      url === '/api/hiring-posts/postings'
        ? { ok: true, json: async () => ({ posting: { id: 'np' } }) }
        : { ok: true, json: async () => ({ contents: [] }) }
    )
    open()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/d/recruiting/postings/np/build'))
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/hiring-posts/postings/np/apply-template',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ templateId: 'tpl', mode: 'append' }),
      })
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('템플릿 적용이 실패해도 초안으로 이동하고 안내한다', async () => {
    ;(fetch as jest.Mock).mockImplementation(async (url: string) =>
      url === '/api/hiring-posts/postings'
        ? { ok: true, json: async () => ({ posting: { id: 'np' } }) }
        : { ok: false }
    )
    open()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/d/recruiting/postings/np/build'))
    expect(toast.error).toHaveBeenCalledWith(
      '공고는 만들었지만 템플릿을 적용하지 못했습니다. 공고 꾸미기에서 다시 불러오세요.'
    )
  })
})
