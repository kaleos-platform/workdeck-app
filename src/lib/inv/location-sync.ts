// 위치 연동 설정(위킵 등) 검증 — prisma 미의존(순수 함수)
export const SYNC_PROVIDERS = ['wekeep'] as const
export type SyncProvider = (typeof SYNC_PROVIDERS)[number]

export type SyncState = {
  syncProvider: string | null
  syncSecretName: string | null
  autoReconcileWeekly: boolean
}

type SyncBody = {
  syncProvider?: unknown
  syncSecretName?: unknown
  autoReconcileWeekly?: unknown
}

/**
 * PATCH body의 연동 필드를 검증해 최종 상태를 계산한다.
 * - 연동 필드가 하나도 없으면 effectiveType이 3PL이 아닐 때만 기존 연동을 해제한다.
 * - 비밀값 존재(LOGIN·같은 Space) 확인은 호출 측이 secretName으로 한다.
 */
export function resolveSyncState(
  body: SyncBody,
  current: SyncState,
  effectiveType: string
):
  | { ok: true; state: SyncState | null; secretToCheck: string | null }
  | { ok: false; message: string } {
  const touched =
    body.syncProvider !== undefined ||
    body.syncSecretName !== undefined ||
    body.autoReconcileWeekly !== undefined
  if (!touched) {
    // 3PL이 아니게 바뀌면 연동 해제
    if (effectiveType !== 'THIRD_PARTY' && current.syncProvider) {
      return {
        ok: true,
        state: { syncProvider: null, syncSecretName: null, autoReconcileWeekly: false },
        secretToCheck: null,
      }
    }
    return { ok: true, state: null, secretToCheck: null }
  }

  let provider: string | null = current.syncProvider
  if (body.syncProvider !== undefined) {
    if (body.syncProvider === null || body.syncProvider === '') provider = null
    else if (SYNC_PROVIDERS.includes(body.syncProvider as SyncProvider))
      provider = body.syncProvider as string
    else return { ok: false, message: '지원하지 않는 외부 연동입니다' }
  }
  if (!provider) {
    if (body.autoReconcileWeekly === true)
      return { ok: false, message: '외부 연동을 설정해야 주간 자동 조정을 켤 수 있습니다' }
    return {
      ok: true,
      state: { syncProvider: null, syncSecretName: null, autoReconcileWeekly: false },
      secretToCheck: null,
    }
  }
  if (effectiveType !== 'THIRD_PARTY')
    return { ok: false, message: '외부 연동은 3PL 위치에만 설정할 수 있습니다' }

  let secretName = current.syncSecretName
  if (body.syncSecretName !== undefined) {
    if (body.syncSecretName === null || body.syncSecretName === '') secretName = null
    else if (typeof body.syncSecretName === 'string') secretName = body.syncSecretName
    else return { ok: false, message: '로그인 비밀값 이름이 올바르지 않습니다' }
  }
  if (!secretName) return { ok: false, message: '로그인 비밀값을 선택하세요' }

  let weekly = current.autoReconcileWeekly
  if (body.autoReconcileWeekly !== undefined) {
    if (typeof body.autoReconcileWeekly !== 'boolean')
      return { ok: false, message: 'autoReconcileWeekly는 true/false여야 합니다' }
    weekly = body.autoReconcileWeekly
  }
  return {
    ok: true,
    state: { syncProvider: provider, syncSecretName: secretName, autoReconcileWeekly: weekly },
    secretToCheck: secretName,
  }
}
