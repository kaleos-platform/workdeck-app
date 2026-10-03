import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  render(<PostingsTable postings={[]} total={0} page={1} pageSize={50} q="" status="ALL" />)
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
  render(<PostingsTable postings={[]} total={0} page={1} pageSize={50} q="" status="ALL" />)
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
  render(<PostingsTable postings={[]} total={0} page={1} pageSize={50} q="" status="ALL" />)
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
