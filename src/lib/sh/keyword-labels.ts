// 키워드 마스터 enum 한국어 라벨 — 가이드 §24 Status/Source 표준값, §13 분류 체계 표기 그대로.
//
// Prisma enum 에는 라벨을 넣을 수 없으므로 여기서 Record 로 관리한다.
//
// import 는 **type-only 다.** 이 파일은 클라이언트 컴포넌트에서도 import 되므로
// (src/lib/sh/keyword-* 전반의 규약 — keyword-normalize.ts 상단 주석 참조) 런타임 값을
// 끌어오면 안 된다. `import type` 은 빌드 시 완전히 지워지고, 대신 enum 값이 바뀌면
// 아래 Record 가 컴파일 에러를 내므로 스키마와의 드리프트가 자동으로 잡힌다.
import type {
  KeywordChangeReason,
  KeywordLinkRole,
  KeywordMasterSource,
  KeywordMasterStatus,
  KeywordMasterType,
} from '@/generated/prisma/enums'

/** §24 Status 표준값 표기 */
export const KEYWORD_STATUS_LABELS: Record<KeywordMasterStatus, string> = {
  PRODUCT_NAME: '상품명',
  SEARCH_TERM: '검색어',
  SEARCH_OPTION: '검색옵션',
  CANDIDATE: '후보',
  EXCLUDED: '제외',
  BANNED: '금지',
}

/** §24 Source 표준값 표기 */
export const KEYWORD_SOURCE_LABELS: Record<KeywordMasterSource, string> = {
  COUPANG_AUTOCOMPLETE: '쿠팡 자동완성',
  COUPANG_RELATED: '쿠팡 연관검색',
  COUPANG_TOP_PRODUCT: '쿠팡 상위상품',
  COUPANG_REVIEW: '쿠팡 리뷰',
  AD_KEYWORD: '광고 검색어',
  CUSTOMER_INQUIRY: '고객문의',
  INTERNAL: '내부 아이디어',
}

/** §13 후보 분류 체계 A~G + §8.5 경쟁 브랜드 */
export const KEYWORD_TYPE_LABELS: Record<KeywordMasterType, string> = {
  SYNONYM: '동의어',
  PARENT_CATEGORY: '상위 카테고리',
  MATERIAL: '소재',
  SHAPE: '형태',
  PURPOSE: '용도',
  FEATURE: '특징',
  ALIAS: '별칭 및 영문명',
  COMPETITOR: '경쟁 브랜드',
  UNCLASSIFIED: '미분류',
}

/**
 * §25 상품명 변경 사유. 여기 있는 값이 곧 "변경해도 되는 사유"의 전부다 —
 * §25 의 "변경하지 않음" 항목(노출 감소·단기 광고 성과 등)은 선택지가 없다.
 */
export const KEYWORD_CHANGE_REASON_LABELS: Record<KeywordChangeReason, string> = {
  WRONG_MAIN_KEYWORD: '잘못된 메인 키워드',
  UNCLEAR_NAME: '상품을 이해하기 어려운 상품명',
  POLICY_RISK: '정책 위반 가능성',
  NEW_SEARCH_DATA: '새로운 검색 데이터 근거',
  SPEC_CHANGE: '실제 제품 사양 변경',
  BRAND_MODEL_CHANGE: '브랜드/모델 변경',
  INITIAL_REGISTRATION: '최초 등록',
  TYPO_FIX: '오탈자 수정',
  OTHER: '기타',
}

/** 상품/리스팅에 대한 키워드 역할 */
export const KEYWORD_LINK_ROLE_LABELS: Record<KeywordLinkRole, string> = {
  MAIN: '메인',
  SUB: '서브',
  DENY: '사용 안 함',
}

// ─── AI 초안(name-draft) 전용 라벨 ─────────────────────────────────────────────
// Prisma enum 이 아니라 AI 응답 스키마의 문자열 유니온이다. 서버(keyword-ai-draft /
// keyword-draft-filter)와 클라이언트(name-draft-dialog)가 같은 값을 써야 하므로 여기 둔다.

/** 검색어 생성 축 — §13 분류 체계를 "무엇을 뽑을지" 관점으로 재구성한 것. */
export type KeywordIntent =
  | 'PURPOSE' // 용도
  | 'TARGET' // 대상
  | 'SITUATION' // 상황
  | 'ATTRIBUTE' // 속성
  | 'PROBLEM' // 문제해결
  | 'LONGTAIL' // 롱테일

export const KEYWORD_INTENT_LABELS: Record<KeywordIntent, string> = {
  PURPOSE: '용도',
  TARGET: '대상',
  SITUATION: '상황',
  ATTRIBUTE: '속성',
  PROBLEM: '문제해결',
  LONGTAIL: '롱테일',
}

/**
 * 등록된 검색어에 대한 AI 판정.
 *
 * 여기 있는 값은 **결정적 검증기(keyword-validate)가 잡을 수 없는 것들만** 이다 —
 * 중복·금지어·길이는 규칙으로 잡아 후보 단계에서 버리고, 사람 판단이 필요한 항목만
 * 라벨로 남겨 사용자에게 보여준다(오판이 무음 삭제로 이어지지 않도록).
 */
export type KeywordReviewLabel =
  | 'KEEP' // 문제 없음
  | 'LOW_RELEVANCE' // 상품과 관련성 약함
  | 'COMPETITOR_BRAND' // 경쟁 브랜드
  | 'FALSE_CLAIM' // 없는 기능·효능
  | 'CATEGORY_STUFFING' // 카테고리명 나열
  | 'LOW_INTENT' // 구매 의도 낮음
  | 'MOVE_TO_OPTION' // §20 검색옵션으로 관리할 값

export const KEYWORD_REVIEW_LABELS: Record<KeywordReviewLabel, string> = {
  KEEP: '유지',
  LOW_RELEVANCE: '관련성 낮음',
  COMPETITOR_BRAND: '경쟁 브랜드',
  FALSE_CLAIM: '없는 기능',
  CATEGORY_STUFFING: '카테고리 나열',
  LOW_INTENT: '구매의도 낮음',
  MOVE_TO_OPTION: '검색옵션으로',
}
