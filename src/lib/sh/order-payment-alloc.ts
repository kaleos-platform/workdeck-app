// 주문 결제금액 → 라인별 매출 배분 (순수 함수, Prisma 비의존).
//
// DelOrderItem 에는 금액 컬럼이 없고 DelOrder.paymentAmount 만 주문 단위로 있다.
// 상품 단위 매출을 내려면 주문 금액을 라인으로 내려야 한다.
//
// 배분 기준은 **수량 비례** 하나다. margin-query.ts 의 정가(retailPrice) 비례와
// 의도적으로 다르다 — 정가 비례는 미매칭 라인에 가중치가 없어(옵션 FK 자체가 없음)
// 매칭 라인이 주문 결제액 100% 를 흡수하고, 그만큼 상품 매출과 커버리지가 동시에
// 부풀어난다. 수량은 모든 라인에 정의되므로 Σ라인 = paymentAmount 가 정확히 닫히고,
// 그래야 "랭킹 합계 + 미매칭 = 채널탭 총매출" 불변식이 성립한다.
//
// 주의: 이건 "미매칭을 상품으로 흩뿌리는" 추정 배분이 아니다. 방향이 반대로,
// 주문 결제액을 라인으로 내리면서 미매칭 라인의 몫을 미매칭 버킷에 남기는 작업이다.
//
// ponytail: 가격대가 크게 다른 상품이 한 주문에 섞이면 저가품 매출이 과대평가된다.
// 단일 라인 주문(대다수)에선 무관. 라인 단가가 생기면 그때 단가 비례로 바꾼다.

/**
 * 주문 결제금액을 라인 수량 비례로 정수 배분한다 (최대 잔여법 — 합이 정확히 보존됨).
 *
 * @param paymentAmount 주문 결제금액. 음수/NaN 은 0 취급.
 * @param lineQuantities 라인별 수량 (라인 순서 보존).
 * @returns 라인별 매출. 수량 합이 0 이하면 전부 0 —
 *          호출부가 `paymentAmount - Σ결과` 를 미매칭으로 잡아야 한다.
 */
export function allocateOrderPayment(
  paymentAmount: number | null | undefined,
  lineQuantities: number[]
): number[] {
  const payment = Number.isFinite(paymentAmount) ? Math.max(0, Number(paymentAmount)) : 0
  const qtys = lineQuantities.map((q) => (Number.isFinite(q) ? Math.max(0, q) : 0))
  const totalQty = qtys.reduce((a, b) => a + b, 0)
  if (payment <= 0 || totalQty <= 0) return qtys.map(() => 0)

  const exact = qtys.map((q) => (payment * q) / totalQty)
  const floored = exact.map((v) => Math.floor(v))
  let remainder = Math.round(payment - floored.reduce((a, b) => a + b, 0))

  // 소수부가 큰 라인부터 1원씩 채운다 (동률이면 앞선 라인 우선).
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (remainder <= 0) break
    floored[i] += 1
    remainder -= 1
  }
  return floored
}
