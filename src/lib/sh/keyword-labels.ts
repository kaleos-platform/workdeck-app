// 키워드 마스터 enum 한국어 라벨 — 가이드 §24 Status/Source 표준값, §13 분류 체계 표기 그대로.
//
// Prisma enum 에는 라벨을 넣을 수 없으므로 여기서 Record 로 관리한다.
//
// import 는 **type-only 다.** 이 파일은 클라이언트 컴포넌트에서도 import 되므로
// (src/lib/sh/keyword-* 전반의 규약 — keyword-normalize.ts 상단 주석 참조) 런타임 값을
// 끌어오면 안 된다. `import type` 은 빌드 시 완전히 지워지고, 대신 enum 값이 바뀌면
// 아래 Record 가 컴파일 에러를 내므로 스키마와의 드리프트가 자동으로 잡힌다.
import type {
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

/** 상품/리스팅에 대한 키워드 역할 */
export const KEYWORD_LINK_ROLE_LABELS: Record<KeywordLinkRole, string> = {
  MAIN: '메인',
  SUB: '서브',
  DENY: '사용 안 함',
}
