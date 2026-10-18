/**
 * MCP 호출 주체(principal)와 scope 정의.
 * scope는 덱 단위다. ":write"는 "제안 가능"을 뜻하고 실행 권한이 아니다(실행은 구성원 승인 뒤).
 * browser:* 는 (d) 작업 큐에서 검사한다. finance:write·sellerhub:write·slack:write는 spec 목록에 없지만
 * 기존 쓰기 도구와 slack_post를 막으려면 필요해서 추가했다.
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
  'browser:read',
  'browser:write',
  'slack:write',
  'sc:read',
  'sc:write',
] as const

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
