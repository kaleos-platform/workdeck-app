import { inviteView } from '../invite-page-state'

const pending = { state: 'pending' as const, inviteEmail: 'invitee@example.com' }

it('무효 초대', () => {
  expect(inviteView({ state: 'expired', inviteEmail: 'a@b.com', user: null })).toBe('invalid')
  expect(inviteView({ state: 'revoked', inviteEmail: 'a@b.com', user: null })).toBe('invalid')
  expect(inviteView({ state: 'accepted', inviteEmail: 'a@b.com', user: null })).toBe('invalid')
  expect(inviteView({ state: 'not_found', inviteEmail: null, user: null })).toBe('invalid')
})
it('비로그인', () => {
  expect(inviteView({ ...pending, user: null })).toBe('anonymous')
})
it('다른 계정(대소문자 무시)', () => {
  expect(inviteView({ ...pending, user: { email: 'other@example.com' } })).toBe('wrong_account')
  expect(inviteView({ ...pending, user: { email: 'Invitee@Example.com' } })).toBe('ready')
})
it('초대 메일로 들어와 비밀번호 미설정이면 needs_password, 설정 뒤 ready', () => {
  const u = { email: 'invitee@example.com', invited_at: '2026-10-15T00:00:00Z', user_metadata: {} }
  expect(inviteView({ ...pending, user: u })).toBe('needs_password')
  expect(inviteView({ ...pending, user: { ...u, user_metadata: { password_set: true } } })).toBe(
    'ready'
  )
})
it('invited_at도 password_set도 없으면 ready', () => {
  expect(
    inviteView({ ...pending, user: { email: 'invitee@example.com', user_metadata: {} } })
  ).toBe('ready')
})
