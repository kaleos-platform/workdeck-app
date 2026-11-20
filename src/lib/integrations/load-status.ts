import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveSpaceCoupangWorkspaceId } from '@/lib/inv/resolve-coupang-workspace'
import { hasRole, type Role } from '@/lib/auth/roles'
import type { IntegrationId, IntegrationStatus } from './catalog'
import type { AttentionItem } from './attention'
import { loadIntegrationAttention } from './load-attention'

export type IntegrationStatuses = Partial<Record<IntegrationId, IntegrationStatus>>

const UNKNOWN: IntegrationStatus = { state: 'unknown' }
const flag = (on: boolean, summary?: string): IntegrationStatus => ({
  state: on ? 'connected' : 'not_connected',
  ...(on && summary ? { summary } : {}),
})

// 출처 하나가 실패해도 그 타일만 unknown으로 두고 페이지는 연다.
// 실패하면 undefined(Prisma는 undefined를 돌려주지 않는다 — null은 '행 없음').
async function safe<T>(source: string, task: () => Promise<T>): Promise<T | undefined> {
  try {
    return await task()
  } catch (err) {
    console.error(`[integrations] 상태 조회 실패: ${source}`, err)
    return undefined
  }
}

const SPACE_CREDENTIALS: [IntegrationId, string][] = [
  ['meta-ads', 'meta-ads'],
  ['google-marketing', 'google-marketing'],
  ['naver-searchad', 'naver-searchad'],
  ['naver-nbaesong', 'naver-commerce'],
]

/**
 * 연결 화면의 타일 상태. MEMBER에게는 관리자 전용 출처(토큰·비밀값·쿠팡 2종·확인 필요)를 조회하지 않고
 * Space 단위 연결 여부만 돌려준다. 요약 문구에는 비밀값·키·채널 ID를 담지 않는다.
 */
export async function loadIntegrationStatuses(
  spaceId: string,
  userId: string,
  role: Role
): Promise<{ statuses: IntegrationStatuses; attention: AttentionItem[] }> {
  const isAdmin = hasRole(role, 'ADMIN')

  const [slack, creds, notion, drive, agentSetting] = await Promise.all([
    safe('slack', () =>
      prisma.slackInstallation.findUnique({ where: { spaceId }, select: { teamName: true } })
    ),
    safe('space-credentials', () =>
      prisma.spaceCredential.findMany({
        where: { spaceId, provider: { in: SPACE_CREDENTIALS.map(([, p]) => p) } },
        select: { provider: true, healthError: true },
      })
    ),
    safe('notion', () =>
      prisma.scNotionConnection.findUnique({ where: { spaceId }, select: { lastError: true } })
    ),
    safe('drive', () =>
      prisma.scDriveConnection.findUnique({
        where: { spaceId },
        select: { rootId: true, lastError: true },
      })
    ),
    safe('agent-setting', () =>
      prisma.spaceAgentSetting.findUnique({ where: { spaceId }, select: { isActive: true } })
    ),
  ])

  const withError = (found: boolean, error: string | null | undefined, ok: string) =>
    found && error
      ? ({ state: 'attention', summary: '연결 확인 필요' } as IntegrationStatus)
      : flag(found, ok)

  const statuses: IntegrationStatuses = {
    slack:
      slack === undefined
        ? UNKNOWN
        : flag(!!slack, isAdmin ? (slack?.teamName ?? undefined) : undefined),
    notion:
      notion === undefined ? UNKNOWN : withError(!!notion, isAdmin ? notion?.lastError : null, ''),
    'google-drive':
      drive === undefined
        ? UNKNOWN
        : // 동기화는 루트 폴더까지 등록해야 된다 — 계정만 만든 상태는 연결 전.
          withError(!!drive?.rootId, isAdmin ? drive?.lastError : null, ''),
    'workdeck-agent': agentSetting === undefined ? UNKNOWN : flag(agentSetting?.isActive ?? true),
  }

  for (const [id, provider] of SPACE_CREDENTIALS) {
    const row = creds?.find((c) => c.provider === provider)
    statuses[id] =
      creds === undefined ? UNKNOWN : withError(!!row, isAdmin ? row?.healthError : null, '')
  }

  if (!isAdmin) return { statuses, attention: [] }

  const [coupangWs, agentCount, secretCount, attention] = await Promise.all([
    safe('coupang-workspace', () => resolveSpaceCoupangWorkspaceId(spaceId, userId)),
    safe('agents', () => prisma.spaceAgent.count({ where: { spaceId, status: 'ACTIVE' } })),
    safe('secrets', () => prisma.spaceSecret.count({ where: { spaceId } })),
    loadIntegrationAttention(spaceId, userId),
  ])

  if (coupangWs === undefined) {
    statuses['coupang-api'] = UNKNOWN
    statuses['coupang-login'] = UNKNOWN
  } else if (coupangWs === null) {
    statuses['coupang-api'] = flag(false)
    statuses['coupang-login'] = flag(false)
  } else {
    const [api, login] = await Promise.all([
      safe('coupang-api', () =>
        prisma.coupangApiCredential.findUnique({
          where: { workspaceId: coupangWs },
          select: { isActive: true },
        })
      ),
      safe('coupang-login', () =>
        prisma.coupangCredential.findUnique({
          where: { workspaceId: coupangWs },
          select: { isActive: true },
        })
      ),
    ])
    statuses['coupang-api'] = api === undefined ? UNKNOWN : flag(!!api?.isActive)
    statuses['coupang-login'] = login === undefined ? UNKNOWN : flag(!!login?.isActive)
  }
  statuses['agent-tokens'] =
    agentCount === undefined ? UNKNOWN : flag(agentCount > 0, `${agentCount}개 사용 중`)
  statuses.secrets =
    secretCount === undefined ? UNKNOWN : flag(secretCount > 0, `${secretCount}개 등록`)

  for (const item of attention) {
    statuses[item.id] = { state: 'attention', summary: '확인 필요' }
  }
  return { statuses, attention }
}
