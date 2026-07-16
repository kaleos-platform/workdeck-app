// @jest-environment node
import { signState, verifyState } from '../state'

describe('OAuth install state 서명', () => {
  const OLD_ENV = process.env.SLACK_SIGNING_SECRET

  beforeAll(() => {
    process.env.SLACK_SIGNING_SECRET = 'test-signing-secret'
  })
  afterAll(() => {
    process.env.SLACK_SIGNING_SECRET = OLD_ENV
  })

  test('라운드트립 — sign 후 verify로 spaceId/userId 복원', () => {
    const state = signState({ spaceId: 'space-1', userId: 'user-1' })
    const parsed = verifyState(state)
    expect(parsed).toEqual({ spaceId: 'space-1', userId: 'user-1' })
  })

  test('페이로드 변조 → null', () => {
    const state = signState({ spaceId: 'space-1', userId: 'user-1' })
    const [payloadB64, sig] = state.split('.')
    // 페이로드를 다른 값으로 교체(서명은 원래 것 유지) → 서명 불일치.
    const tampered = `${Buffer.from(
      JSON.stringify({ spaceId: 'evil', userId: 'user-1', exp: Date.now() + 60000 })
    ).toString('base64url')}.${sig}`
    expect(payloadB64).not.toEqual(tampered.split('.')[0])
    expect(verifyState(tampered)).toBeNull()
  })

  test('만료된 state → null', () => {
    // exp를 과거로 만든 페이로드를 직접 서명하기 위해 real signState 후 시간 경과를 흉내낸다.
    // signState는 항상 now+10분이므로, exp 조작을 위해 verify가 만료를 잡는지만 확인.
    const state = signState({ spaceId: 'space-1', userId: 'user-1' })
    const realNow = Date.now
    // 20분 뒤로 시간을 진행 → exp(now+10분) 초과.
    Date.now = () => realNow() + 20 * 60 * 1000
    try {
      expect(verifyState(state)).toBeNull()
    } finally {
      Date.now = realNow
    }
  })

  test('형식 오류(점 없음) → null', () => {
    expect(verifyState('no-dot-here')).toBeNull()
  })
})
