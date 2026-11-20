/** @jest-environment node */
import crypto from 'node:crypto'
import { signState, verifyState } from '@/lib/slack/state'
import { createCafe24State, nonceMatches, verifyCafe24State } from '../oauth-state'

const input = { spaceId: 'sp1', userId: 'u1', clientId: 'cid-1234567', mallId: 'myshop24' }

beforeEach(() => {
  process.env.SLACK_SIGNING_SECRET = 'test-signing-secret'
})
afterEach(() => jest.useRealTimers())

it('서명한 state 를 검증하면 payload 를 돌려주고 nonce 원문은 state 에 없다', () => {
  const { state, nonce } = createCafe24State(input)!
  const p = verifyCafe24State(state)!
  expect(p).toMatchObject(input)
  expect(state).not.toContain(nonce)
  expect(nonceMatches(p, nonce)).toBe(true)
})

it('nonce 쿠키가 없거나 다르면 일치하지 않는다', () => {
  const { state } = createCafe24State(input)!
  const p = verifyCafe24State(state)!
  expect(nonceMatches(p, undefined)).toBe(false)
  expect(nonceMatches(p, 'other-nonce')).toBe(false)
})

it('위조·변조·만료 state 는 거부한다', () => {
  const { state } = createCafe24State(input)!
  expect(verifyCafe24State(state + 'x')).toBeNull()
  expect(verifyCafe24State('garbage')).toBeNull()
  const [payload] = state.split('.')
  const tampered = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), spaceId: 'evil' })
  ).toString('base64url')
  expect(verifyCafe24State(`${tampered}.${state.split('.')[1]}`)).toBeNull()
  jest.useFakeTimers().setSystemTime(Date.now() + 11 * 60 * 1000)
  expect(verifyCafe24State(state)).toBeNull()
})

it('state purpose 분리: Slack state 와 카페24 state 는 서로 검증되지 않는다', () => {
  const slack = signState({ spaceId: 'sp1', userId: 'u1' })
  expect(verifyCafe24State(slack)).toBeNull()
  // 같은 payload 를 Slack 키(원 비밀)로 서명해도 카페24 검증은 통과하지 못한다
  const { state } = createCafe24State(input)!
  const [payload] = state.split('.')
  const slackKeySig = crypto
    .createHmac('sha256', 'test-signing-secret')
    .update(payload)
    .digest('base64url')
  expect(verifyCafe24State(`${payload}.${slackKeySig}`)).toBeNull()
  expect(verifyState(state)).toBeNull()
})

it('SLACK_SIGNING_SECRET 이 없으면 만들 수 없고 검증도 실패한다', () => {
  const { state } = createCafe24State(input)!
  delete process.env.SLACK_SIGNING_SECRET
  expect(createCafe24State(input)).toBeNull()
  expect(verifyCafe24State(state)).toBeNull()
})
