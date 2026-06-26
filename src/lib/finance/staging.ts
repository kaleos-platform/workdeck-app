/**
 * 재무 스테이징 — 확정 저장(commit) 대상 판정.
 * "저장 처리"는 임포트와 무관하게 **분류완료(CLASSIFIED) 행만** 확정 거래로 저장한다.
 * 미분류·검토는 보류, 중복(DUP_SAME)은 제외.
 */
import type { FinClassStatus, FinStagedResolution } from '@/generated/prisma/enums'

export function isStagedRowCommittable(row: {
  classStatus: FinClassStatus
  resolution: FinStagedResolution
}): boolean {
  return row.classStatus === 'CLASSIFIED' && row.resolution !== 'DUP_SAME'
}
