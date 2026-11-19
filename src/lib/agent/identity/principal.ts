/**
 * MCP 호출 주체(principal)와 scope 정의.
 * scope는 업무(deck) 단위 읽기/쓰기 + 비밀값(secret:*)이다.
 * ":write" = 그 업무의 쓰기 권한 — 워크덱 안에서 끝나는 작업은 바로 실행되고, 외부 반영은 구성원 승인을 거친다.
 * slack_post 는 별도 scope 없이 "업무 쓰기 scope 가 하나라도 있는 에이전트·연동 계정"에만 허용한다(slack-tools.ts).
 */
export const SCOPES = [
  'sellerhub:read',
  'sellerhub:write',
  'finance:read',
  'finance:write',
  'ads:read',
  'ads:write',
  'meta:read',
  'meta:write',
  'google:read',
  'google:write',
  'naver:read',
  'sc:read',
  'sc:write',
  'secret:read',
  'secret:write',
  'secret:env',
  'hiring:read',
  'hiring:write',
] as const

/** 폐지된 scope — 저장값에서는 조용히 제거하고, 새 입력으로는 거부한다(2026-11-20). */
export const LEGACY_SCOPES: readonly string[] = [
  'draft:create',
  'slack:write',
  'browser:read',
  'browser:write',
]

/** 업무 쓰기 scope(`*:write`, 비밀값 제외). 바로 실행·slack_post 권한의 기준. */
export function isDeckWriteScope(scope: string): boolean {
  return scope.endsWith(':write') && !scope.startsWith('secret:')
}

export type Scope = (typeof SCOPES)[number]
export const ALL_SCOPES: Scope[] = [...SCOPES]

export type ActorType = 'user' | 'agent' | 'integration' | 'system'
export interface Actor {
  type: ActorType
  id: string
}

export interface McpPrincipal {
  spaceId: string
  actor: Actor
  scopes: Scope[]
  /** 연동 계정(integration)으로 들어온 구성원 세션의 실제 User.id — 감사 로그 requesterUserId. */
  requesterUserId?: string
  /** 에이전트 토큰으로 들어온 경우 AgentToken.id — 제안(actorTokenId)에 남겨 승인 실행 때 폐기를 재확인한다. */
  tokenId?: string
}

/** 저장·입력된 scope 배열을 검증한다. 모르는 값이 하나라도 있으면 throw. */
export function parseScopes(input: unknown): Scope[] {
  if (!Array.isArray(input)) throw new Error('scopes는 배열이어야 합니다')
  for (const s of input) {
    if (typeof s !== 'string' || !(SCOPES as readonly string[]).includes(s)) {
      throw new Error(`알 수 없는 scope: ${String(s)}`)
    }
  }
  return [...new Set(input as Scope[])]
}

/** DB·토큰에 저장된 scope 배열을 읽는다 — 폐지된 값은 버리고 나머지만 검증한다. */
export function parseStoredScopes(input: unknown): Scope[] {
  if (!Array.isArray(input)) throw new Error('scopes는 배열이어야 합니다')
  return parseScopes(input.filter((s) => !LEGACY_SCOPES.includes(s as string)))
}

/**
 * slack_post 허용 — 업무 쓰기 scope(비밀값 제외)가 하나라도 있는 에이전트·연동 계정·인증된 구성원(user)만.
 * system(내장 에이전트)·미인증 컨텍스트는 거부한다(별도 scope 없이 행위자 종류로 막는다).
 */
export function canPostSlack(ctx: { actor: Actor; scopes: readonly string[] }): boolean {
  return (
    (ctx.actor.type === 'agent' || ctx.actor.type === 'integration' || ctx.actor.type === 'user') &&
    ctx.scopes.some(isDeckWriteScope)
  )
}
