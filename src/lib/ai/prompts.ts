// AI 분석 시스템 프롬프트 정의

import type { AnalysisType } from '@/generated/prisma/client'
import type { ActiveRule } from '@/lib/analysis/data-builder'

// 응답 JSON 스키마를 프롬프트에 포함시켜 구조화된 출력을 유도
const SUGGESTION_SCHEMA = `
## 중요: 응답 형식
반드시 순수 JSON만 반환하세요. 마크다운, 설명 텍스트, 코드블록 없이 JSON 객체만 출력합니다.
형식:
{
  "suggestions": [
    {
      "type": "REMOVE_KEYWORD" | "ADJUST_BID" | "PAUSE_CAMPAIGN" | "ADJUST_BUDGET",
      "priority": "HIGH" | "MEDIUM" | "LOW",
      "campaignId": "캠페인 ID",
      "target": "대상 키워드 또는 캠페인명",
      "reason": "한국어로 구체적인 이유",
      "currentValue": 현재값(숫자, 선택),
      "suggestedValue": 제안값(숫자, 선택),
      "estimatedImpact": "예상 효과 설명(선택)"
    }
  ],
  "improvementSuggestions": [
    {
      "rule": "새로 추가할 분석 규칙 (한국어)",
      "reason": "이 규칙을 제안하는 이유"
    }
  ]
}
`.trim()

// 제거 히스토리 참조 지시
const REMOVAL_HISTORY_INSTRUCTION = `
## 제거 히스토리 참조 규칙
- 이미 제거된 키워드는 다시 제거 제안하지 마세요.
- 이미 제거된 상품은 다시 제거 제안하지 마세요.
- 제거 이력을 참고하여 유사한 패턴의 키워드/상품을 식별하세요.
`.trim()

// 목표 ROAS 비교 지시
const TARGET_ROAS_INSTRUCTION = `
## 목표 ROAS 대비 실적 분석
- 각 캠페인의 목표 ROAS와 실제 ROAS를 비교하세요.
- 목표 대비 크게 미달하는 캠페인은 우선적으로 개선 제안하세요.
- 목표 대비 초과 달성하는 캠페인은 예산 증액을 검토하세요.
`.trim()

// 메모 참조 지시
const MEMO_INSTRUCTION = `
## 메모 참조
- 최근 메모에 기록된 광고 운영 이력을 참고하세요.
- 메모에서 언급된 의도나 전략을 존중하여 제안하세요.
`.trim()

// 개선 규칙 제안 지시
const IMPROVEMENT_SUGGESTION_INSTRUCTION = `
## 개선 규칙 제안
- 분석 결과를 바탕으로 향후 분석에 적용할 수 있는 새로운 규칙 1~2개를 improvementSuggestions에 제안하세요.
- 기존 규칙과 중복되지 않는 구체적이고 측정 가능한 규칙을 제안하세요.
- 예: "3일 연속 CTR 0.3% 미만인 키워드는 제거 대상으로 분류"
`.trim()

// 분석 유형별 기본 시스템 프롬프트
const BASE_PROMPTS: Record<AnalysisType, string> = {
  DAILY_REVIEW: `당신은 쿠팡 광고 분석 전문가입니다. 다음 광고 데이터를 분석하고 개선 제안을 JSON으로 반환하세요.

분석 기준:
- ROAS가 100% 미만인 캠페인은 예산 조정 또는 일시 중지 검토
- 광고비를 사용했지만 주문이 0인 키워드는 제거 대상
- CTR이 0.5% 미만인 키워드는 입찰가 조정 검토
- 전환율이 높은 키워드는 입찰가 증액 검토`,

  KEYWORD_AUDIT: `당신은 쿠팡 키워드 광고 최적화 전문가입니다. 키워드별 성과 데이터를 분석하고 비효율 키워드를 식별하세요.

분석 기준:
- 광고비 대비 전환이 없는 키워드 → REMOVE_KEYWORD
- CTR이 극히 낮은 키워드 → ADJUST_BID (입찰가 하향)
- ROAS가 높은 키워드 → ADJUST_BID (입찰가 상향)`,

  BUDGET_OPTIMIZATION: `당신은 쿠팡 광고 예산 최적화 전문가입니다. 캠페인별 예산 사용률과 성과를 분석하여 최적 예산 배분을 제안하세요.

분석 기준:
- ROAS가 높은 캠페인에 예산 증액 제안
- ROAS가 낮은 캠페인에 예산 감액 또는 일시 중지 제안
- 전체 예산 대비 효율적 배분 방안`,

  CAMPAIGN_SCORING: `당신은 쿠팡 광고 캠페인 평가 전문가입니다. 각 캠페인의 종합 점수를 산출하고 개선 방향을 제안하세요.

평가 기준:
- CTR, CVR, ROAS 종합 점수
- 예산 소진율 대비 성과
- 개선 가능성이 높은 캠페인 우선 제안`,
}

/**
 * 동적 규칙이 주입된 시스템 프롬프트 생성
 */
export function getSystemPrompt(type: AnalysisType, activeRules?: ActiveRule[]): string {
  const parts: string[] = [BASE_PROMPTS[type]]

  // 동적 분석 규칙 주입
  if (activeRules && activeRules.length > 0) {
    const rulesBlock = activeRules
      .map((r, i) => `${i + 1}. ${r.rule}`)
      .join('\n')
    parts.push(`\n## 필수 분석 규칙 (반드시 적용)\n${rulesBlock}`)
  }

  // 추가 지시사항
  parts.push(REMOVAL_HISTORY_INSTRUCTION)
  parts.push(TARGET_ROAS_INSTRUCTION)
  parts.push(MEMO_INSTRUCTION)
  parts.push(IMPROVEMENT_SUGGESTION_INSTRUCTION)
  parts.push(SUGGESTION_SCHEMA)

  return parts.join('\n\n')
}
