import type { BoMaterialStatus } from '@/generated/prisma/client'

// ─── 허용된 상태 전환 맵 ─────────────────────────────────────────────────────
// PROPOSED → APPROVED | REJECTED
// REJECTED → PROPOSED  (재검토)
// APPROVED → ARCHIVED  (보관)
// ARCHIVED → (없음)

const ALLOWED_TRANSITIONS: Record<BoMaterialStatus, BoMaterialStatus[]> = {
  PROPOSED: ['APPROVED', 'REJECTED'],
  REJECTED: ['PROPOSED'],
  APPROVED: ['ARCHIVED'],
  ARCHIVED: [],
}

export class BoMaterialTransitionError extends Error {
  constructor(
    public readonly from: BoMaterialStatus,
    public readonly to: BoMaterialStatus
  ) {
    super(`소재 상태를 ${from} → ${to} 로 변경할 수 없습니다`)
    this.name = 'BoMaterialTransitionError'
  }
}

// 전환이 허용되지 않으면 BoMaterialTransitionError 던짐
export function assertBoMaterialTransition(from: BoMaterialStatus, to: BoMaterialStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? []
  if (!allowed.includes(to)) {
    throw new BoMaterialTransitionError(from, to)
  }
}

// 특정 상태에서 이동 가능한 상태 목록 반환
export function getAllowedTransitions(from: BoMaterialStatus): BoMaterialStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? []
}
