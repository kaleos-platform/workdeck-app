// 역할 계층: OWNER > ADMIN > MEMBER — 무거운 의존(api-helpers) 없이 쓰는 순수 판정.
export type Role = 'OWNER' | 'ADMIN' | 'MEMBER'

const RANK: Record<Role, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 }

export function hasRole(role: Role, required: Role): boolean {
  return RANK[role] >= RANK[required]
}
