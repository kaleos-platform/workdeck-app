import MessageTemplatesRedirectPage from '../page'

const redirect = jest.fn()
jest.mock('next/navigation', () => ({ redirect: (p: string) => redirect(p) }))

it('구 메시지 템플릿 경로는 설정 메시지 관리로 이동한다', () => {
  MessageTemplatesRedirectPage()
  expect(redirect).toHaveBeenCalledWith('/d/recruiting/settings/messages')
})
