import type { FinStagedResolution } from '@/generated/prisma/enums'

/**
 * 재업로드 커밋 시 기존 확정 거래의 분류(categoryId·classStatus·matchedRuleId·isTransfer)를
 * 보존할지 판정한다.
 *
 * 기본은 보존이다. 재임포트 자동분류가 사용자가 손으로 한 분류를 덮지 않아야 하기 때문.
 * 「유지」(DUP_OVERWRITE)를 누른 행만 재업로드분 분류를 반영한다 — 사용자가 명시적으로
 * 덮어쓰기를 선택한 경우다.
 *
 * 단 재업로드분이 미분류(stagedCategoryId=null)면 「유지」를 눌렀어도 보존한다.
 * 반영할 분류가 없는데 덮으면 기존 분류를 지우는 결과가 되기 때문이다. 실제로 미분류
 * 중복 238건이 모두 기존 거래에 분류를 갖고 있어, 이 가드가 없으면 전부 날아간다.
 */
export function shouldPreserveClassification(args: {
  /** 기존 확정 거래에 분류가 있는가 */
  priorClassified: boolean
  resolution: FinStagedResolution
  /** 재업로드분(스테이징 행)의 분류 */
  stagedCategoryId: string | null
}): boolean {
  if (!args.priorClassified) return false
  if (args.resolution !== 'DUP_OVERWRITE') return true
  return args.stagedCategoryId == null
}
