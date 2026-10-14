/**
 * 승인 결정에 필요한 역할 — 웹 승인(PATCH)과 Slack 승인 버튼이 같이 쓴다.
 *  - 기본: 액션 정의의 requiredRole(없으면 ADMIN)
 *  - 지출 제안(spendKrw > Space.approvalLimitKrw, null=0): 승인은 OWNER(회사 대표 계정)
 *  - 거부는 기본 역할로 충분하다(돈이 나가지 않는다).
 */
import { prisma } from '@/lib/prisma'
import { hasRole, type Role } from '@/lib/auth/roles'
import { getActionDefinition } from './registry'

export async function requiredDecisionRole(
  action: { spaceId: string; actionType: string; payload: unknown },
  decision: 'approve' | 'reject',
  /** 이미 조회한 Space 승인 한도(목록에서 행마다 재조회하지 않도록). 생략하면 여기서 조회한다. */
  approvalLimitKrw?: number | null
): Promise<Role> {
  const def = getActionDefinition(action.actionType)
  const base: Role = def?.requiredRole ?? 'ADMIN'
  if (decision === 'reject' || !def?.spendKrw) return base

  const amount = spendKrwOf(action)
  if (amount === undefined) return 'OWNER' // 금액을 해석할 수 없는 지출 액션은 보수적으로
  if (amount === null) return base

  const limit =
    approvalLimitKrw !== undefined
      ? approvalLimitKrw
      : (
          await prisma.space.findUnique({
            where: { id: action.spaceId },
            select: { approvalLimitKrw: true },
          })
        )?.approvalLimitKrw
  return amount > (limit ?? 0) ? 'OWNER' : base
}

/** 지출 금액(원) — 지출 액션이 아니거나 금액이 없으면 null, 파라미터를 해석할 수 없으면 undefined. */
export function spendKrwOf(action: {
  actionType: string
  payload: unknown
}): number | null | undefined {
  const def = getActionDefinition(action.actionType)
  if (!def?.spendKrw) return null
  const parsed = def.paramsSchema.safeParse(action.payload)
  return parsed.success ? def.spendKrw(parsed.data) : undefined
}

/**
 * 결정자 검사 — 승인의 행위자는 항상 Space 구성원이다(에이전트·워커·레거시 'slack:U…' 문자열은 거부).
 * 통과면 null, 거부면 사람에게 보여줄 사유.
 */
export async function deciderDenial(
  action: { spaceId: string; actionType: string; payload: unknown },
  deciderId: string,
  decision: 'approve' | 'reject'
): Promise<string | null> {
  const member = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: action.spaceId, userId: deciderId } },
    select: { role: true },
  })
  if (!member) return '이 공간의 구성원만 결정할 수 있습니다.'
  const required = await requiredDecisionRole(action, decision)
  if (hasRole(member.role as Role, required)) return null
  return required === 'OWNER'
    ? '지출 제안은 OWNER(회사 대표 계정)만 승인할 수 있습니다. 워크덱 승인 화면에서 승인하세요.'
    : '승인 권한이 없습니다(ADMIN 이상 필요).'
}
