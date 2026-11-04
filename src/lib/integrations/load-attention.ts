import 'server-only'
import { prisma } from '@/lib/prisma'
import { listSecretMeta } from '@/lib/agent/secrets/store'
import { resolveSpaceCoupangWorkspaceId } from '@/lib/inv/resolve-coupang-workspace'
import { buildAttention, coupangProbeError } from './attention'

// 요약 하나가 실패해도 페이지는 연다 — 각 카드가 자기 오류를 보여 준다.
async function orFallback<T>(source: string, task: Promise<T>, fallback: T) {
  try {
    return await task
  } catch (err) {
    console.error(`[integrations] 확인 필요 요약 실패: ${source}`, err)
    return fallback
  }
}

// 자격증명을 다시 저장하기 전의 테스트 결과는 보지 않는다.
async function loadCoupangError(spaceId: string, userId: string) {
  const workspaceId = await resolveSpaceCoupangWorkspaceId(spaceId, userId)
  if (!workspaceId) return null
  const credential = await prisma.coupangApiCredential.findUnique({
    where: { workspaceId },
    select: { updatedAt: true },
  })
  if (!credential) return null
  const run = await prisma.collectionRun.findFirst({
    where: {
      workspaceId,
      probeApi: true,
      status: { in: ['COMPLETED', 'FAILED'] },
      createdAt: { gt: credential.updatedAt },
    },
    orderBy: { createdAt: 'desc' },
    select: { status: true, error: true, probeResult: true },
  })
  return run ? coupangProbeError(run) : null
}

/** ADMIN 이상에게만 호출한다 — 각 카드의 API와 같은 권한 범위의 값을 읽는다. */
export async function loadIntegrationAttention(spaceId: string, userId: string) {
  const [coupangError, agents, secrets] = await Promise.all([
    orFallback('coupang', loadCoupangError(spaceId, userId), null),
    orFallback(
      'agents',
      prisma.spaceAgent.findMany({
        where: { spaceId, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: {
          name: true,
          tokens: { where: { revokedAt: null }, select: { expiresAt: true } },
        },
      }),
      []
    ),
    orFallback('secrets', listSecretMeta(spaceId), []),
  ])

  return buildAttention({
    coupangError,
    agents,
    envSecrets: secrets.flatMap((s) => {
      const expiresAt = s.config && 'expiresAt' in s.config ? s.config.expiresAt : null
      return typeof expiresAt === 'string' ? [{ name: s.name, expiresAt: new Date(expiresAt) }] : []
    }),
  })
}
