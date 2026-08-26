/**
 * 셀러 허브 상품 도메인 공용 상수.
 *
 * 의존성 없는 순수 상수 모듈이다. schemas.ts와 product-extract.ts가 같은 값을
 * 공유해야 하는데, product-extract.ts는 @google/genai를 참조하므로 schemas.ts가
 * 그쪽을 import 하면 광범위한 런타임/번들 오염이 생긴다. 그래서 값만 여기로 분리한다.
 */

/** 상품 설명(InvProduct.description) 최대 길이. AI 추출 결과도 이 길이로 잘라낸다. */
export const PRODUCT_DESCRIPTION_MAX = 2000

/** 특징·인증정보 배열의 최대 항목 수 */
export const PRODUCT_LIST_FIELD_MAX_ITEMS = 20

/** 특징·인증정보 각 항목의 최대 길이 */
export const PRODUCT_LIST_FIELD_MAX_ITEM_LENGTH = 200
