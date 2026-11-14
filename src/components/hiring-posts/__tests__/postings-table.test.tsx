import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PostingsTable, type PostingRow } from '../postings-table'
const push = jest.fn()
const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))
const props = {
  postings: [],
  total: 501,
  page: 11,
  pageSize: 50,
  q: '강남',
  status: 'DRAFT' as const,
  store: '',
  position: '',
  jobType: '',
}
beforeEach(() => jest.clearAllMocks())

it('제목 입력은 400ms 뒤 자동 적용되고 첫 페이지로 이동한다', () => {
  jest.useFakeTimers()
  render(<PostingsTable {...props} />)
  fireEvent.change(screen.getByLabelText('공고 제목 검색'), { target: { value: '주말' } })
  expect(push).not.toHaveBeenCalled()
  act(() => {
    jest.advanceTimersByTime(400)
  })
  expect(push).toHaveBeenLastCalledWith('/d/recruiting/postings?q=%EC%A3%BC%EB%A7%90&status=DRAFT')
  expect(screen.queryByRole('button', { name: '검색' })).not.toBeInTheDocument()
  jest.useRealTimers()
})

it('행 제목과 지원자 수는 링크이고 메뉴에 발행 공고용 항목이 있다', async () => {
  const row = {
    id: 'p1',
    uuid: 'u-1',
    title: '합성 공고',
    status: 'ACTIVE' as const,
    closingDate: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    applicantCount: 3,
    receptionExpired: false,
  }
  const fetchMock = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ posting: { status: 'CLOSED' } }) })
  global.fetch = fetchMock as unknown as typeof fetch
  render(<PostingsTable {...props} postings={[row]} total={1} page={1} q="" status="ALL" />)
  expect(screen.getByRole('link', { name: '합성 공고' })).toHaveAttribute(
    'href',
    '/d/recruiting/postings/p1'
  )
  expect(screen.getByRole('link', { name: /지원자 3명/ })).toHaveAttribute(
    'href',
    '/d/recruiting/postings/p1?tab=applicants'
  )
  fireEvent.click(screen.getByRole('link', { name: '합성 공고' }))
  expect(push).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('합성 공고').closest('tr')!)
  expect(push).toHaveBeenLastCalledWith('/d/recruiting/postings/p1')
  fireEvent.keyDown(screen.getByRole('button', { name: '행 메뉴' }), { key: 'Enter' })
  expect(await screen.findByRole('menuitem', { name: '지원서 링크 복사' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: '마감일 연장' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('menuitem', { name: '마감' }))
  expect(fetchMock).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toHaveTextContent('공고를 마감할까요?')
  fireEvent.click(screen.getByRole('button', { name: '마감하기' }))
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/hiring-posts/postings/p1/actions',
      expect.objectContaining({ body: JSON.stringify({ action: 'close' }) })
    )
  )
})

it('초기화할 때 미적용 입력도 즉시 비운다', () => {
  render(<PostingsTable {...props} q="" />)
  fireEvent.change(screen.getByLabelText('모집 장소'), { target: { value: '입력 중' } })
  fireEvent.click(screen.getByRole('button', { name: '초기화' }))
  expect(screen.getByLabelText('모집 장소')).toHaveValue('')
})

it('고용 형태 선택을 즉시 적용하며 입력 중인 검색 조건도 보존한다', () => {
  render(<PostingsTable {...props} />)
  fireEvent.change(screen.getByLabelText('모집 직무'), { target: { value: '서빙' } })
  fireEvent.change(screen.getByLabelText('고용 형태'), { target: { value: 'PART_TIME' } })
  expect(push).toHaveBeenLastCalledWith(expect.stringContaining('position=%EC%84%9C%EB%B9%99'))
  expect(push).toHaveBeenLastCalledWith(expect.stringContaining('jobType=PART_TIME'))
})

it('장소·직무·고용 형태를 검색하고 페이지 이동 시 조건을 유지한다', () => {
  render(<PostingsTable {...props} store="강남" position="서빙" jobType="PART_TIME" />)
  fireEvent.click(screen.getByRole('button', { name: '이전' }))
  expect(push).toHaveBeenLastCalledWith(expect.stringContaining('store=%EA%B0%95%EB%82%A8'))
  expect(push).toHaveBeenLastCalledWith(expect.stringContaining('position=%EC%84%9C%EB%B9%99'))
  expect(push).toHaveBeenLastCalledWith(expect.stringContaining('jobType=PART_TIME'))
  fireEvent.change(screen.getByLabelText('모집 장소'), { target: { value: '홍대' } })
  fireEvent.submit(screen.getByRole('search'))
  expect(push).toHaveBeenLastCalledWith(expect.stringContaining('store=%ED%99%8D%EB%8C%80'))
  expect(push).toHaveBeenLastCalledWith(expect.not.stringContaining('page='))
})

it('페이지 이동에서 확정 검색·상태를 유지하고 검색 제출은 첫 페이지로 이동한다', () => {
  render(<PostingsTable {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '이전' }))
  expect(push).toHaveBeenLastCalledWith(
    '/d/recruiting/postings?q=%EA%B0%95%EB%82%A8&status=DRAFT&page=10'
  )
  expect(screen.getByRole('button', { name: '다음' })).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox', { name: '공고 제목 검색' }), {
    target: { value: '  주말  ' },
  })
  fireEvent.submit(screen.getByRole('search'))
  expect(push).toHaveBeenLastCalledWith('/d/recruiting/postings?q=%EC%A3%BC%EB%A7%90&status=DRAFT')
})

it('범위를 벗어난 빈 페이지에서는 필터를 유지한 첫 페이지 복구를 제공한다', () => {
  render(<PostingsTable {...props} page={12} />)
  fireEvent.click(screen.getByRole('button', { name: '첫 페이지로' }))
  expect(push).toHaveBeenLastCalledWith('/d/recruiting/postings?q=%EA%B0%95%EB%82%A8&status=DRAFT')
})

it('상태 변경은 확정 검색어를 보존하고 입력 중인 검색어와 이전 page를 사용하지 않는다', () => {
  render(<PostingsTable {...props} />)
  fireEvent.change(screen.getByRole('textbox', { name: '공고 제목 검색' }), {
    target: { value: '미제출' },
  })
  fireEvent.keyDown(screen.getByRole('tab', { name: '전체' }), { key: 'Enter' })
  expect(push).toHaveBeenLastCalledWith('/d/recruiting/postings?q=%EA%B0%95%EB%82%A8')
  fireEvent.click(screen.getByRole('button', { name: '초기화' }))
  expect(push).toHaveBeenLastCalledWith('/d/recruiting/postings')
})

const baseRow: PostingRow = {
  id: 'p1',
  uuid: 'u-1',
  title: '합성 공고',
  status: 'ACTIVE' as const,
  closingDate: '2099-12-31T00:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
  applicantCount: 0,
  receptionExpired: false,
}

async function menuNames(row: PostingRow) {
  const { unmount } = render(
    <PostingsTable {...props} postings={[row]} total={1} page={1} q="" status="ALL" />
  )
  fireEvent.keyDown(screen.getByRole('button', { name: '행 메뉴' }), { key: 'Enter' })
  const names = (await screen.findAllByRole('menuitem')).map((el) => el.textContent)
  unmount()
  return names
}

it('행 메뉴 항목은 상태와 접수 만료 여부에 따라 달라진다', async () => {
  expect(await menuNames(baseRow)).toEqual([
    '수정',
    '복사',
    '지원서 링크 복사',
    '마감일 연장',
    '마감',
  ])
  expect(await menuNames({ ...baseRow, receptionExpired: true })).toEqual([
    '수정',
    '복사',
    '마감일 연장',
    '마감',
  ])
  expect(await menuNames({ ...baseRow, status: 'CLOSED' })).toEqual(['수정', '복사', '마감일 연장'])
  expect(await menuNames({ ...baseRow, closingDate: null })).toEqual([
    '수정',
    '복사',
    '지원서 링크 복사',
    '마감',
  ])
  expect(await menuNames({ ...baseRow, status: 'DRAFT' })).toEqual(['수정', '복사'])
})

it('마감일 연장 팝업에서 연장하면 API를 호출하고 목록을 새로고침한다', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ posting: { id: 'p1', status: 'ACTIVE', closingDate: '2100-01-07' } }),
  })
  global.fetch = fetchMock as unknown as typeof fetch
  render(<PostingsTable {...props} postings={[baseRow]} total={1} page={1} q="" status="ALL" />)
  fireEvent.keyDown(screen.getByRole('button', { name: '행 메뉴' }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: '마감일 연장' }))
  expect(screen.getByLabelText('새 마감일')).toHaveValue('2100-01-07')
  fireEvent.click(screen.getByRole('button', { name: '연장하기' }))
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    action: 'extend',
    closingDate: '2100-01-07',
  })
})
