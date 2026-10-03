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
    '외부 채용사이트에 게시'
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
