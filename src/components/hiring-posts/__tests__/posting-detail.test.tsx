import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PostingDetail } from '../posting-detail'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

it('초안에서도 HTML을 우선 복사하고 앱 CSS와 격리된 미리보기를 제공한다', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const html = '<div><p style="color:red">테스트 공고</p></div>'
  render(
    <PostingDetail
      posting={{
        id: 'test',
        uuid: 'public-test',
        title: '테스트',
        status: 'DRAFT',
        closingDate: null,
      }}
      origin="https://workdeck.test"
      embedHtml={html}
    />
  )
  expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent(
    '모집 기간 및 접수 상태'
  )
  fireEvent.click(screen.getByRole('button', { name: 'HTML 복사' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(html))
  const frame = screen.getByTitle('외부 게시용 공고 미리보기')
  expect(frame).toHaveAttribute('sandbox', '')
  expect(frame.getAttribute('srcdoc')).toContain(html)
})

it('출력 누락 오류가 있으면 수정할 카드를 안내하고 HTML 복사를 막는다', () => {
  const writeText = jest.fn()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'DRAFT', closingDate: null }}
      origin="https://workdeck.test"
      embedHtml="<div></div>"
      embedIssues={[
        { blockNumber: 2, severity: 'error', message: '이미지가 저장되지 않았습니다.' },
      ]}
    />
  )
  expect(screen.getByRole('alert')).toHaveTextContent('카드 2: 이미지가 저장되지 않았습니다.')
  expect(screen.getByRole('button', { name: 'HTML 복사' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'HTML 복사' }))
  expect(writeText).not.toHaveBeenCalled()
  expect(screen.getByRole('link', { name: '공고 수정하기' })).toHaveAttribute(
    'href',
    '/d/recruiting/postings/test/build'
  )
})

it('초안의 지원서 링크와 빈 직무는 안내하되 HTML 복사를 허용한다', () => {
  render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'DRAFT', closingDate: null }}
      origin="https://workdeck.test"
      embedHtml="<p>QA</p>"
      usesFormLink
      embedIssues={[{ blockNumber: 2, severity: 'warning', message: '등록된 직무가 없습니다.' }]}
    />
  )
  expect(screen.getByText(/현재 지원 접수가 열려 있지 않습니다/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'HTML 복사' })).toBeEnabled()
})

it('초안 HTML 복사 완료 시 접수 불가 안내와 발행 설정 경로를 제공한다', async () => {
  const { toast } = await import('sonner')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: jest.fn().mockResolvedValue(undefined) },
  })
  render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'DRAFT', closingDate: null }}
      origin="https://workdeck.test"
      embedHtml="<p>QA</p>"
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'HTML 복사' }))
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith('HTML 코드를 복사했습니다', {
      description: '초안 공고는 발행 전까지 지원서 링크로 접수할 수 없습니다.',
      duration: 8000,
    })
  )
  expect(screen.getByRole('button', { name: '공고 발행' })).toBeInTheDocument()
})

it('지난 마감일을 팝업에서 수정해 한 요청으로 발행한다', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ posting: { status: 'ACTIVE', closingDate: '2099-12-31T00:00:00Z' } }),
  })
  render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'DRAFT', closingDate: '2023-11-30' }}
      origin="https://workdeck.test"
      embedHtml="<p>QA</p>"
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '공고 발행' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('마감일이 지났습니다')
  expect(screen.getByRole('button', { name: '발행하기' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('지원서 마감일'), { target: { value: '2099-12-31' } })
  fireEvent.click(screen.getByRole('button', { name: '발행하기' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({
    action: 'publish',
    closingDate: '2099-12-31',
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('region', { name: '모집 기간 및 접수 상태' })).toHaveTextContent('2099')
})

it('발행 실패 시 팝업과 입력한 날짜를 유지하고 오류를 안내한다', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ message: '발행 요건 미충족', errors: ['직무를 등록하세요'] }),
  })
  render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'DRAFT', closingDate: null }}
      origin="https://workdeck.test"
      embedHtml="<p>QA</p>"
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '공고 발행' }))
  fireEvent.change(screen.getByLabelText('지원서 마감일'), { target: { value: '2099-12-31' } })
  fireEvent.click(screen.getByRole('button', { name: '발행하기' }))
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('직무를 등록하세요'))
  expect(screen.getByLabelText('지원서 마감일')).toHaveValue('2099-12-31')
  expect(screen.getByRole('button', { name: '발행하기' })).toBeEnabled()
})

it('보관 공고도 상세에서 다시 발행할 수 있다', () => {
  render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'ARCHIVED', closingDate: null }}
      origin="https://workdeck.test"
      embedHtml="<p>QA</p>"
    />
  )
  expect(screen.getByRole('button', { name: '공고 발행' })).toBeInTheDocument()
})
