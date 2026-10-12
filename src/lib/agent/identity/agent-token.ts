import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { timingSafeEqualString } from '@/lib/crypto/timing-safe'
import { hashWorkerToken, workerTokenExpiry } from '@/lib/worker-auth'
import { parseScopes, type McpPrincipal } from './principal'

/**
 * 에이전트 토큰: `wdk_agt_<tokenId>.<secret>`.
 * tokenId로 행을 찾고 sha256(secret)을 상수 시간 비교한다(해시 컬럼 인덱스 스캔 없이 O(1)).
 * 평문은 issueAgentToken 반환값에서 한 번만 나온다.
 * 만료 정책은 WorkerToken과 같다 — 1~365일 정수, 만료 없는 토큰은 없다.
 */
export const AGENT_TOKEN_PREFIX = 'wdk_agt_'
const TOKEN_RE = /^wdk_agt_([a-z0-9]{20,40})\.([A-Za-z0-9_-]{43})$/
const DEFAULT_EXPIRES_DAYS = 365
// lastUsedAt 갱신 간격 — 매 호출마다 쓰지 않는다.
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000

/** sha256(secret) hex — WorkerToken과 같은 해시. */
export function hashTokenSecret(secret: string): string {
  return hashWorkerToken(secret)
}

export function parseAgentToken(raw: string): { tokenId: string; secret: string } | null {
  const m = TOKEN_RE.exec(raw)
  return m ? { tokenId: m[1], secret: m[2] } : null
}

/** expiresInDays가 1~365 정수가 아니면 throw(workerTokenExpiry). */
export async function issueAgentToken(
  agentId: string,
  opts?: { expiresInDays?: number }
): Promise<{ tokenId: string; token: string; expiresAt: Date }> {
  const expiresAt = workerTokenExpiry(opts?.expiresInDays ?? DEFAULT_EXPIRES_DAYS)
  const secret = crypto.randomBytes(32).toString('base64url') // 43자
  const row = await prisma.agentToken.create({
    data: { agentId, tokenHash: hashTokenSecret(secret), expiresAt },
    select: { id: true },
  })
  return { tokenId: row.id, token: `${AGENT_TOKEN_PREFIX}${row.id}.${secret}`, expiresAt }
}

export async function revokeAgentToken(agentId: string, tokenId: string): Promise<boolean> {
  const r = await prisma.agentToken.updateMany({
    where: { id: tokenId, agentId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return r.count === 1
}

export async function verifyAgentToken(
  raw: string,
  now = new Date()
): Promise<McpPrincipal | null> {
  const parsed = parseAgentToken(raw)
  if (!parsed) return null
  const row = await prisma.agentToken.findUnique({
    where: { id: parsed.tokenId },
    select: {
      id: true,
      tokenHash: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      agent: { select: { id: true, spaceId: true, kind: true, scopes: true, status: true } },
    },
  })
  if (!row) return null
  if (!timingSafeEqualString(hashTokenSecret(parsed.secret), row.tokenHash)) return null
  if (row.revokedAt) return null
  // 컬럼은 nullable이지만 만료 없는 토큰은 허용하지 않는다.
  if (!row.expiresAt || row.expiresAt <= now) return null
  if (row.agent.status !== 'ACTIVE') return null
  if (row.agent.kind !== 'agent' && row.agent.kind !== 'integration') return null

  // 마지막 사용 시각 — 실패해도 인증은 막지 않는다.
  prisma.agentToken
    .updateMany({
      where: {
        id: row.id,
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_THROTTLE_MS) } },
        ],
      },
      data: { lastUsedAt: now },
    })
    .catch((err: unknown) => console.error('[agent-token] lastUsedAt 갱신 실패', err))

  return {
    spaceId: row.agent.spaceId,
    actor: { type: row.agent.kind as 'agent' | 'integration', id: row.agent.id },
    scopes: parseScopes(row.agent.scopes),
  }
}
