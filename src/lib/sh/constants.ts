/**
 * 셀러 허브 상품 도메인 공용 상수.
 *
 * 의존성 없는 순수 상수 모듈이다. schemas.ts와 product-extract.ts가 같은 값을
 * 공유해야 하는데, product-extract.ts는 @google/genai를 참조하므로 schemas.ts가
 * 그쪽을 import 하면 광범위한 런타임/번들 오염이 생긴다. 그래서 값만 여기로 분리한다.
 */

/** 상품 설명(InvProduct.description) 최대 길이. AI 추출 결과도 이 길이로 잘라낸다. */
export const PRODUCT_DESCRIPTION_MAX = 2000

/** 인증정보·성분·주의사항 배열의 최대 항목 수 (특징은 PRODUCT_FEATURES_MAX_ITEMS) */
export const PRODUCT_LIST_FIELD_MAX_ITEMS = 20

/**
 * 특징(features) 배열의 최대 항목 수.
 *
 * 특징은 상품마다 필요한 만큼 만들 수 있어야 하므로 실질적으로 무제한이다.
 * 이 값은 페이로드 폭주만 막는 안전 상한이며, AI 출력(주제 단위 묶음)이나
 * 사람이 손으로 넣는 개수가 여기에 닿는 일은 없다.
 */
export const PRODUCT_FEATURES_MAX_ITEMS = 200

/** 특징·인증정보 각 항목의 최대 길이 */
export const PRODUCT_LIST_FIELD_MAX_ITEM_LENGTH = 200
