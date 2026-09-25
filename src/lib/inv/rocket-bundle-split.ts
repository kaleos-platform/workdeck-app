// 로켓그로스 외부 코드 → 내부 옵션 묶음 팬아웃 (순수 함수, Prisma 비의존).
//
// ⚠️ 수량과 매출의 산식이 다르다. 여기를 복붙으로 합치면 매출이 조용히 부풀어난다.
//   - 수량: 외부 1개 안에 내부 N개가 들어있으므로 **배수** (qty × item.quantity)
//   - 매출: 외부 1건의 매출을 구성 옵션에 나눠 갖는 것이므로 **보존 배분**
//           (revenue × item.quantity / Σitem.quantity)

export type BundleItem = { optionId: string; quantity: number }
export type BundleSplitRow = { optionId: string; quantity: number; revenue: number }

/**
 * 외부 옵션 1건의 (수량, 매출)을 묶음 구성 옵션으로 분해한다.
 * 매출은 최대 잔여법으로 정수 배분해 합이 정확히 보존된다.
 *
 * @returns 수량·매출이 둘 다 0인 구성은 제외. 매핑이 비면 빈 배열.
 *          수량 0 + 매출 음수(반품/환불)는 살린다 — 버리면 총매출 합계가 어긋난다.
 */
export function splitRocketBundle(
  qty: number,
  revenue: number,
  items: BundleItem[]
): BundleSplitRow[] {
  const valid = items.filter((it) => it.quantity > 0)
  if (valid.length === 0) return []

  const weightSum = valid.reduce((a, it) => a + it.quantity, 0)
  // 음수(반품/환불) 허용 — 클램프하면 총매출 합계가 어긋난다.
  const rev = Number.isFinite(revenue) ? revenue : 0

  const exact = valid.map((it) => (rev * it.quantity) / weightSum)
  const revs = exact.map((v) => Math.floor(v))
  let remainder = Math.round(rev - revs.reduce((a, b) => a + b, 0))
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (remainder <= 0) break
    revs[i] += 1
    remainder -= 1
  }

  return valid
    .map((it, i) => ({
      optionId: it.optionId,
      quantity: qty * it.quantity, // 배수 — 매출과 다르다
      revenue: revs[i],
    }))
    .filter((r) => r.quantity > 0 || r.revenue !== 0)
}
