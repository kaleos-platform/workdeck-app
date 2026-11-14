// POST /api/sh/inventory/reorder/plan
// DRAFT 발주 계획 생성
//
// 흐름:
//  1) config 로드 + 입고 완료 계획 정산(settleEligiblePlans)
//  2) loadPlanOptionInputs — 주문수요·재고·품절일·직전 정산 bias·모델 실적 (MCP 발주 액션과 공용)
//  3) computeProductPlan — 품절일 제외 시계열 → 모델 비교·백테스트 추천·상품 단위 선택
//     → 발주량 = 일률 × (리드타임 + 목표 커버일수) + 안전재고 − 현재고 − 입고 예정
//  4) LLM rationale 생성 (실패 시 결정론적 폴백 텍스트)
//  5) ReorderPlan + ReorderPlanItem 트랜잭션 저장
//  6) { planId, items } 응답

import { NextRequest } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import {
  runReorderPlanRequest,
  type ReorderPlanRequestBody,
} from '@/lib/inv/reorder-engine/run-plan-request'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error
  let body: ReorderPlanRequestBody = {}
  try {
    body = await req.json()
  } catch {
    // 파싱 실패 시 빈 바디 → 검증에서 차단
  }
  return runReorderPlanRequest({ spaceId: resolved.space.id, userId: resolved.user.id }, body)
}
