// 쿠팡 로켓그로스 상품등급(InventoryRecord.productGrade) 판정.
//
// 쿠팡은 고객 반품품을 등급 매겨 **별도 상품으로 재등록**한다. 그 리스팅은
// productId·optionId·skuId 가 전부 새로 발급되므로 재고현황에 독립 행으로 잡히고,
// 같은 상품·옵션이 화면에 두세 번 반복되는 것처럼 보인다.
//
// 실측 값(2026-09 prod): 'NEW' | '반품-최상' | '반품-상' | '반품-중' | '반품-미개봉'

/**
 * 반품 등급 여부.
 *
 * 등급 목록을 하드코딩하지 않는다 — 쿠팡이 새 반품 등급을 추가하면 조용히 정상
 * 재고로 편입돼 발주가 재고를 과대평가한다. `contains '반품'` 규칙은
 * app/api/inventory/route.ts / summary/route.ts 의 기존 필터와 동일하다.
 *
 * 값이 없으면 false(정상) — 등급을 싣지 않던 시절의 데이터와 등급이 없는
 * 수집 경로(Open API)를 오늘과 같은 동작으로 유지하기 위한 기본값이다.
 */
export function isReturnGrade(grade?: string | null): boolean {
  return !!grade && grade.includes('반품')
}
