// Content 상태 머신. D11:
//   TODO → DRAFT → IN_REVIEW → APPROVED → SCHEDULED → PUBLISHED → ANALYZED
//   APPROVED → DRAFT (한 방향 역전만 허용 — 승인 후 재작성)
//   TODO: 토픽만 선정된 상태 (본문 없음) — 아이데이션에서 "콘텐츠로 보내기" 시 진입

import type { ContentStatus } from '@/generated/prisma/client'

const TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  TODO: ['DRAFT'], // 작성 시작 시 DRAFT 전환
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['APPROVED', 'DRAFT'], // 리뷰 반려 시 DRAFT 복귀
  APPROVED: ['SCHEDULED', 'PUBLISHED', 'DRAFT'],
  SCHEDULED: ['PUBLISHED', 'APPROVED'], // 스케줄 취소 시 APPROVED
  PUBLISHED: ['ANALYZED'],
  ANALYZED: [],
}

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  if (from === to) return false
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function nextAllowed(from: ContentStatus): ContentStatus[] {
  return TRANSITIONS[from] ?? []
}

// IN_REVIEW 이상으로 전환할 때 최소 본문 길이 요구 (빈 초안 방지).
export const MIN_DOC_TEXT_LENGTH_FOR_REVIEW = 50

// 단순 텍스트 길이 계산 — TipTap doc 의 paragraph content 누적.
export function countDocTextLength(doc: unknown): number {
  if (!doc || typeof doc !== 'object') return 0
  const node = doc as { type?: string; content?: unknown[]; text?: string }
  let total = 0
  if (typeof node.text === 'string') total += node.text.length
  if (Array.isArray(node.content)) {
    for (const child of node.content) total += countDocTextLength(child)
  }
  return total
}
