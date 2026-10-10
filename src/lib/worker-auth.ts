/**
 * 워커 인증 — Space 범위 토큰(WorkerToken). 헤더는 기존과 같은 x-worker-api-key.
 *  - `wdw_` 로 시작하면 sha256 해시로 조회(평문 비저장). 폐기·미존재는 401.
 *  - 레거시 단일 키(WORKER_API_KEY)는 전환 기간에만(WORKER_LEGACY_KEY_ENABLED=1) 허용하고 범위 제한이 없다.
 *    전환 완료 후 이 분기는 삭제한다(Task 7 Step 8). 레거시 키가 `wdw_` 로 시작하면 도달할 수 없으므로 설정 오류로 throw.
 * Space ↔ 레거시 Workspace 사이에 FK 가 없으므로(ADR-0002) 토큰의 워크스페이스는
 * 로켓그로스 위치의 externalIntegrationKey 로 해석한다 — cron 과 같은 축. 단, 인증 경계이므로
 * 모호하면 연결 없음으로 보는 resolveCoupangWorkspaceForSpaceStrict 를 쓴다.
 * ⚠️ api-helpers 를 import 하지 않는다(워커 라우트 연결 때 api-helpers 가 이 파일을 import 하면 순환이 된다).
 */
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { timingSafeEqualString } from '@/lib/crypto/timing-safe'
import { resolveCoupangWorkspaceForSpaceStrict } from '@/lib/inv/resolve-coupang-workspace'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'

export type WorkerScope =
  | { kind: 'legacy' }
  | { kind: 'space'; tokenId: string; spaceId: string; workspaceId: string | null }

export const WORKER_TOKEN_PREFIX = 'wdw_'
export const WORKER_TOKEN_DEFAULT_TTL_DAYS = 90
const WORKER_TOKEN_MAX_TTL_DAYS = 365
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000

export function workerTokenExpiry(ttlDays: number, now = new Date()): Date {
  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > WORKER_TOKEN_MAX_TTL_DAYS) {
    throw new Error(`TTL 은 1~${WORKER_TOKEN_MAX_TTL_DAYS}일 정수여야 합니다`)
  }
  return new Date(now.getTime() + ttlDays * 24 * 3600 * 1000)
}

export function hashWorkerToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

export function generateWorkerToken(): { token: string; tokenHash: string } {
  const token = WORKER_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url')
  return { token, tokenHash: hashWorkerToken(token) }
}

function unauthorized() {
  return NextResponse.json({ message: '워커 인증에 실패했습니다' }, { status: 401 })
}

function forbidden(message = '다른 공간의 자원에 접근할 수 없습니다') {
  return NextResponse.json({ message }, { status: 403 })
}

export async function authenticateWorker(
  headers: Headers
): Promise<{ scope: WorkerScope } | { error: NextResponse }> {
  const presented = headers.get('x-worker-api-key')
  if (!presented) return { error: unauthorized() }

  if (presented.startsWith(WORKER_TOKEN_PREFIX)) {
    // 고엔트로피 토큰의 해시를 unique 인덱스로 조회한다 — 비교 대상이 평문이 아니라 타이밍 비교가 필요 없다.
    const row = await prisma.workerToken.findUnique({
      where: { tokenHash: hashWorkerToken(presented) },
      select: { id: true, spaceId: true, revokedAt: true, expiresAt: true, lastUsedAt: true },
    })
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now())
      return { error: unauthorized() }
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      await prisma.workerToken
        .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined) // 사용 시각 기록 실패가 인증을 막으면 안 된다
    }
    const coupang = await resolveCoupangWorkspaceForSpaceStrict(row.spaceId)
    return {
      scope: {
        kind: 'space',
        tokenId: row.id,
        spaceId: row.spaceId,
        workspaceId: coupang?.workspaceId ?? null,
      },
    }
  }

  const legacy = process.env.WORKER_API_KEY
  if (process.env.WORKER_LEGACY_KEY_ENABLED === '1' && legacy?.startsWith(WORKER_TOKEN_PREFIX)) {
    throw new Error(
      `WORKER_API_KEY 가 ${WORKER_TOKEN_PREFIX} 로 시작하면 레거시 키로 쓸 수 없습니다`
    )
  }
  if (
    process.env.WORKER_LEGACY_KEY_ENABLED === '1' &&
    legacy &&
    timingSafeEqualString(presented, legacy)
  ) {
    return { scope: { kind: 'legacy' } }
  }
  return { error: unauthorized() }
}

export function workerOwns(
  scope: WorkerScope,
  target: { spaceId?: string | null; workspaceId?: string | null }
): boolean {
  if (scope.kind === 'legacy') return true
  if (target.spaceId !== undefined && target.spaceId !== scope.spaceId) return false
  if (target.workspaceId !== undefined) {
    if (!scope.workspaceId || target.workspaceId !== scope.workspaceId) return false
  }
  return true
}

export function assertWorkerOwns(
  scope: WorkerScope,
  target: { spaceId?: string | null; workspaceId?: string | null }
): NextResponse | null {
  return workerOwns(scope, target) ? null : forbidden()
}

// 폴링/목록 쿼리용 where 조각. 쿠팡 워크스페이스가 없는 Space 토큰은 아무것도 못 본다.
export function workerWorkspaceWhere(scope: WorkerScope): {
  workspaceId?: string | { in: string[] }
} {
  if (scope.kind === 'legacy') return {}
  return scope.workspaceId ? { workspaceId: scope.workspaceId } : { workspaceId: { in: [] } }
}

export function workerSpaceWhere(scope: WorkerScope): { spaceId?: string } {
  return scope.kind === 'legacy' ? {} : { spaceId: scope.spaceId }
}

/**
 * 워커 요청의 워크스페이스 결정.
 *  - space: 토큰의 워크스페이스. requested(x-workspace-id 등)가 다르면 403.
 *  - legacy: 기존 폴백 체인(요청값 → WORKER_DEFAULT_WORKSPACE_ID → 쿠팡 연동 위치 → 최고참 워크스페이스).
 */
export async function resolveWorkerWorkspaceId(
  scope: WorkerScope,
  requested: string | null
): Promise<{ workspaceId: string } | { error: NextResponse }> {
  if (scope.kind === 'space') {
    if (!scope.workspaceId)
      return { error: forbidden('이 공간에 연결된 쿠팡 워크스페이스가 없습니다') }
    if (requested && requested !== scope.workspaceId) return { error: forbidden() }
    return { workspaceId: scope.workspaceId }
  }

  for (const id of [requested, process.env.WORKER_DEFAULT_WORKSPACE_ID]) {
    if (!id) continue
    const ws = await prisma.workspace.findUnique({ where: { id }, select: { id: true } })
    if (ws) return { workspaceId: ws.id }
  }
  const linked = await prisma.invStorageLocation.findFirst({
    where: {
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
      isActive: true,
      externalIntegrationKey: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    select: { externalIntegrationKey: true },
  })
  if (linked?.externalIntegrationKey) {
    const ws = await prisma.workspace.findUnique({
      where: { id: linked.externalIntegrationKey },
      select: { id: true },
    })
    if (ws) return { workspaceId: ws.id }
  }
  const ws = await prisma.workspace.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (ws) return { workspaceId: ws.id }
  return { error: NextResponse.json({ message: '워크스페이스가 없습니다' }, { status: 404 }) }
}
