import { resolveSyncState } from '../location-sync'

const none = { syncProvider: null, syncSecretName: null, autoReconcileWeekly: false }
const linked = { syncProvider: 'wekeep', syncSecretName: 'wk', autoReconcileWeekly: true }

describe('resolveSyncState', () => {
  it('연동 필드 없음 → 변경 없음', () => {
    expect(resolveSyncState({}, none, 'OWN')).toEqual({
      ok: true,
      state: null,
      secretToCheck: null,
    })
  })
  it('3PL 아니게 바뀌면 연동 해제', () => {
    const r = resolveSyncState({}, linked, 'OWN')
    expect(r).toMatchObject({ ok: true, state: none })
  })
  it('3PL 아니면 연동 설정 거부', () => {
    expect(resolveSyncState({ syncProvider: 'wekeep', syncSecretName: 'wk' }, none, 'OWN').ok).toBe(
      false
    )
  })
  it('비밀값 없이 연동 거부', () => {
    expect(resolveSyncState({ syncProvider: 'wekeep' }, none, 'THIRD_PARTY').ok).toBe(false)
  })
  it('설정 성공 + 확인할 비밀값 반환', () => {
    expect(
      resolveSyncState(
        { syncProvider: 'wekeep', syncSecretName: 'wk', autoReconcileWeekly: true },
        none,
        'THIRD_PARTY'
      )
    ).toEqual({ ok: true, state: linked, secretToCheck: 'wk' })
  })
  it('null로 해제하면 비밀값·주간 토글도 초기화', () => {
    expect(resolveSyncState({ syncProvider: null }, linked, 'THIRD_PARTY')).toMatchObject({
      ok: true,
      state: none,
    })
  })
  it('연동 없이 주간 true 거부', () => {
    expect(resolveSyncState({ autoReconcileWeekly: true }, none, 'THIRD_PARTY').ok).toBe(false)
  })
  it('알 수 없는 provider 거부', () => {
    expect(resolveSyncState({ syncProvider: 'x' }, none, 'THIRD_PARTY').ok).toBe(false)
  })
})
