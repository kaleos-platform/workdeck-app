// 채널 포맷 프로필: 플랫폼별 글쓰기 지침 정의.
// 채널 생성 시 기본값으로 사용되며, 채널별로 개별 커스터마이징 가능.

import type { BoPlatform } from '@/generated/prisma/client'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface FormatProfile {
  /** 말투·문체 지침 */
  toneGuide: string
  /** 문단·소제목·구조 지침 */
  structureGuide: string
  /** 권장 분량 범위 (한국어 기준 자 수) */
  lengthRange: { min: number; max: number }
  /** 소제목 스타일 지침 */
  headingStyle: string
  /** 사용 금지 표현 목록 */
  forbiddenExpressions: string[]
  /** CTA(행동 유도) 마무리 스타일 */
  ctaStyle: string
  /** true이면 LLM 변형 없이 마스터 본문을 그대로 복사 */
  passthrough?: boolean
}

// ─── 플랫폼별 기본 프로필 ────────────────────────────────────────────────────

export const DEFAULT_PROFILES: Record<BoPlatform, FormatProfile> = {
  NAVER_BLOG: {
    toneGuide:
      '구어체·친근한 말투로 작성한다. 독자와 대화하듯 쓰되 과도한 반말은 피한다. 이모지는 절제해서 사용한다.',
    structureGuide:
      '짧은 문단(2~3문장)으로 나눠 읽기 쉽게 구성한다. 소제목을 자주 사용해 흐름을 나눈다.',
    lengthRange: { min: 800, max: 2000 },
    headingStyle: '소제목은 ### 수준으로 짧고 친근하게 작성한다. 예: "### 이래서 추천해요"',
    forbiddenExpressions: ['저는', '필자는', '본고에서'],
    ctaStyle:
      '부드러운 권유형으로 마무리한다. 예: "한번 확인해 보세요!", "지금 바로 시작해 보세요~"',
    passthrough: false,
  },
  TISTORY: {
    toneGuide:
      '정보형·전문적 톤으로 작성한다. 검색으로 유입된 독자를 가정해 정보를 명확하게 전달한다.',
    structureGuide:
      'SEO를 고려한 구조로 작성한다. 목록과 소제목을 적극 활용하고 핵심 내용을 먼저 제시한다.',
    lengthRange: { min: 1200, max: 3000 },
    headingStyle:
      '소제목은 질문형 h2(## 로 시작)로 작성한다. 예: "## ~는 왜 중요한가?", "## ~하는 방법"',
    forbiddenExpressions: [],
    ctaStyle: '정보 제공 후 자연스럽게 다음 행동을 유도한다. 과장 없이 구체적으로 안내한다.',
    passthrough: false,
  },
  OWN_HOMEPAGE: {
    toneGuide: '공식·formal 톤으로 작성한다. 브랜드 보이스를 유지한다.',
    structureGuide: '마스터 본문 구조를 그대로 유지한다.',
    lengthRange: { min: 0, max: 999999 },
    headingStyle: '마스터 본문의 헤딩 구조를 변경하지 않는다.',
    forbiddenExpressions: [],
    ctaStyle: '마스터 본문의 CTA를 그대로 유지한다.',
    passthrough: true,
  },
}
