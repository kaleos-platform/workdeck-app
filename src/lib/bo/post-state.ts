import type { BoPostStatus } from '@/generated/prisma/client'

// ─── 허용된 상태 전환 맵 ─────────────────────────────────────────────────────
// GENERATING  → DRAFT | FAILED | ARCHIVED
// DRAFT       → IN_REVIEW | ARCHIVED
// IN_REVIEW   → PUBLISH_APPROVED | DRAFT | ARCHIVED
// PUBLISH_APPROVED → IN_REVIEW(편집 시 자동 회귀) | PUBLISHED | ARCHIVED
// PUBLISHED   → ARCHIVED
// FAILED      → GENERATING | ARCHIVED
// ARCHIVED    → (없음)

const ALLOWED_TRANSITIONS: Record<BoPostStatus, BoPostStatus[]> = {
  GENERATING: ['DRAFT', 'FAILED', 'ARCHIVED'],
  DRAFT: ['IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['PUBLISH_APPROVED', 'DRAFT', 'ARCHIVED'],
  PUBLISH_APPROVED: ['IN_REVIEW', 'PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED'],
  FAILED: ['GENERATING', 'ARCHIVED'],
  ARCHIVED: [],
}

export class BoPostTransitionError extends Error {
  constructor(
    public readonly from: BoPostStatus,
    public readonly to: BoPostStatus
  ) {
    super(`포스트 상태를 ${from} → ${to} 로 변경할 수 없습니다`)
    this.name = 'BoPostTransitionError'
  }
}

// 전환이 허용되지 않으면 BoPostTransitionError 던짐
export function assertBoPostTransition(from: BoPostStatus, to: BoPostStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? []
  if (!allowed.includes(to)) {
    throw new BoPostTransitionError(from, to)
  }
}

// 특정 상태에서 이동 가능한 상태 목록 반환
export function getAllowedPostTransitions(from: BoPostStatus): BoPostStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? []
}
