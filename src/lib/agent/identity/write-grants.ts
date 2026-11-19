/**
 * 쓰기 scope 부여자 기록(SpaceAgent.writeGrants) 계산 — 바로 실행 게이트가 "누가 이 쓰기 권한을 줬는지"로 읽는다.
 * 저장 후 남는 `:write` scope 중 기록이 없는 것은 저장한 관리자·시각으로 채우고, 이미 있는 기록은 유지하며,
 * 빠진 scope 의 기록은 지운다. 같은 목록을 다시 저장해도 기록 없는 쓰기 scope 는 새로 채워진다(재저장 = 명시적 동의).
 */
export interface WriteGrant {
  userId: string
  at: string // ISO
}
export type WriteGrants = Record<string, WriteGrant>

export function computeWriteGrants(
  existing: unknown,
  scopes: readonly string[],
  userId: string,
  now: Date,
  /** 지금도 이 Space 의 ADMIN 이상인 사용자 id — 기록된 부여자가 여기 없으면(탈퇴·강등) 저장한 관리자로 바꾼다. 생략하면 검사 안 함. */
  validGrantors?: ReadonlySet<string>
): WriteGrants {
  const prev = (existing && typeof existing === 'object' ? existing : {}) as Record<string, unknown>
  const next: WriteGrants = {}
  for (const scope of scopes) {
    if (!scope.endsWith(':write')) continue
    const g = prev[scope] as Partial<WriteGrant> | undefined
    next[scope] =
      g &&
      typeof g.userId === 'string' &&
      typeof g.at === 'string' &&
      (!validGrantors || validGrantors.has(g.userId))
        ? { userId: g.userId, at: g.at }
        : { userId, at: now.toISOString() }
  }
  return next
}
