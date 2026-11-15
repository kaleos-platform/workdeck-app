import MessageTemplatesRemovedPage from '../page'

const redirect = jest.fn()
jest.mock('next/navigation', () => ({ redirect: (p: string) => redirect(p) }))

it('제거된 메시지 템플릿 경로는 지원자 목록으로 이동한다', () => {
  MessageTemplatesRemovedPage()
  expect(redirect).toHaveBeenCalledWith('/d/recruiting/applications')
})
