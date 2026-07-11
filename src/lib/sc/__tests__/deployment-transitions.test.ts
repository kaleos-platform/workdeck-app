/**
 * ALLOWED_DEPLOYMENT_TRANSITIONS 상태 전이 맵 유닛 테스트.
 * DB 불필요 — 순수 함수 검증.
 */
import { ALLOWED_DEPLOYMENT_TRANSITIONS } from '../deployment-transitions'

describe('ALLOWED_DEPLOYMENT_TRANSITIONS', () => {
  it('SCHEDULED → CANCELED 허용', () => {
    expect(ALLOWED_DEPLOYMENT_TRANSITIONS['SCHEDULED']).toContain('CANCELED')
  })

  it('SCHEDULED → PUBLISHING 금지 (워커 전용)', () => {
    expect(ALLOWED_DEPLOYMENT_TRANSITIONS['SCHEDULED'] ?? []).not.toContain('PUBLISHING')
  })

  it('FAILED → SCHEDULED 허용 (재시도)', () => {
    expect(ALLOWED_DEPLOYMENT_TRANSITIONS['FAILED']).toContain('SCHEDULED')
  })

  it('FAILED → CANCELED 허용', () => {
    expect(ALLOWED_DEPLOYMENT_TRANSITIONS['FAILED']).toContain('CANCELED')
  })

  it('PUBLISHING 전이 없음 (워커 독점)', () => {
    expect(ALLOWED_DEPLOYMENT_TRANSITIONS['PUBLISHING'] ?? []).toHaveLength(0)
  })

  it('PUBLISHED 전이 없음', () => {
    expect(ALLOWED_DEPLOYMENT_TRANSITIONS['PUBLISHED'] ?? []).toHaveLength(0)
  })

  it('CANCELED → SCHEDULED 허용 (재개)', () => {
    expect(ALLOWED_DEPLOYMENT_TRANSITIONS['CANCELED']).toContain('SCHEDULED')
  })

  it('허용 맵에 없는 상태는 undefined (허용 없음으로 취급)', () => {
    expect(ALLOWED_DEPLOYMENT_TRANSITIONS['UNKNOWN_STATE']).toBeUndefined()
  })
})
