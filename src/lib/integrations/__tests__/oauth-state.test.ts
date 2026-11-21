/** @jest-environment node */
import { createCafe24State } from '@/lib/cafe24/oauth-state'
import { signState, verifyState } from '@/lib/slack/state'
import { createOAuthState, oauthNonceMatches, verifyOAuthState } from '../oauth-state'

const input = { spaceId: 'sp1', userId: 'u1', clientId: 'cid-1234567' }

beforeEach(() => {
  process.env.SLACK_SIGNING_SECRET = 'test-signing-secret'
})
afterEach(() => jest.useRealTimers())

it('서명한 state 를 검증하면 payload 를 돌려주고 nonce 원문은 state 에 없다', () => {
  const { state, nonce } = createOAuthState('google-marketing', input)!
  const p = verifyOAuthState('google-marketing', state)!
  expect(p).toMatchObject(input)
  expect(state).not.toContain(nonce)
  expect(oauthNonceMatches(p, nonce)).toBe(true)
})

it('목적이 다르면 검증 실패 — 구글 state 는 다른 purpose 로 못 쓴다', () => {
  const { state } = createOAuthState('google-marketing', input)!
  expect(verifyOAuthState('cafe24', state)).toBeNull()
  expect(verifyOAuthState('google-marketing', state)).not.toBeNull()
})

it('nonce 쿠키가 없거나 다르면 일치하지 않는다', () => {
  const { state } = createOAuthState('google-marketing', input)!
  const p = verifyOAuthState('google-marketing', state)!
  expect(oauthNonceMatches(p, undefined)).toBe(false)
  expect(oauthNonceMatches(p, 'other-nonce')).toBe(false)
})

it('같은 nonce 쿠키라도 다른 state 의 payload 와는 맞지 않는다(재사용 불가)', () => {
  const a = createOAuthState('google-marketing', input)!
  const b = createOAuthState('google-marketing', input)!
  expect(oauthNonceMatches(verifyOAuthState('google-marketing', b.state)!, a.nonce)).toBe(false)
})

it('위조·변조·만료 state 는 거부한다', () => {
  const { state } = createOAuthState('google-marketing', input)!
  expect(verifyOAuthState('google-marketing', state + 'x')).toBeNull()
  expect(verifyOAuthState('google-marketing', 'abc.def')).toBeNull()
  expect(verifyOAuthState('google-marketing', 'nodot')).toBeNull()
  // payload 만 바꾸고 서명은 그대로
  const [, sig] = state.split('.')
  const forged = Buffer.from(
    JSON.stringify({ ...input, spaceId: 'other', nonceHash: 'x', exp: Date.now() + 1e6 })
  ).toString('base64url')
  expect(verifyOAuthState('google-marketing', `${forged}.${sig}`)).toBeNull()

  jest.useFakeTimers().setSystemTime(Date.now() + 11 * 60 * 1000)
  expect(verifyOAuthState('google-marketing', state)).toBeNull()
})

it('Slack state 와 서로 못 쓴다', () => {
  const slack = signState({ spaceId: 'sp1', userId: 'u1' })
  expect(verifyOAuthState('google-marketing', slack)).toBeNull()
  const { state } = createOAuthState('google-marketing', input)!
  expect(verifyState(state)).toBeNull()
  const cafe24 = createCafe24State({ ...input, mallId: 'myshop24' })!
  expect(verifyOAuthState('google-marketing', cafe24.state)).toBeNull()
})

it('SLACK_SIGNING_SECRET 이 없으면 만들지도 검증하지도 못한다', () => {
  const { state } = createOAuthState('google-marketing', input)!
  delete process.env.SLACK_SIGNING_SECRET
  expect(createOAuthState('google-marketing', input)).toBeNull()
  expect(verifyOAuthState('google-marketing', state)).toBeNull()
})
