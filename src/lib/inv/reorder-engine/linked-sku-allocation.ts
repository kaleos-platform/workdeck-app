// 연동 위치(로켓그로스) 입고 몫을 그 위치의 외부 SKU(1장·3장·5장 세트 등)로 나눈다 — 순수 함수.
//
// 옵션별 연동 위치 몫(linkedQtyByOption)은 엔진이 이미 정했다. 여기서는 그 몫을 SKU 단위로
// "나누기만" 한다. 각 SKU 에 옵션 몫 전체를 넣어 보는 역산(computeSetAvailable)을 SKU 마다
// 따로 돌리면 같은 옵션이 SKU 수만큼 중복 표시된다(누드 L 70개 → 1세트 70 + 5세트 14 + 5세트 14).
//
// 규칙
//  - SKU 부족분(세트 단위) = ceil(30일 판매/30 × 커버 기간) − 현재고 − 입고예정 (≥0)
//  - 옵션 몫으로 SKU 부족분(낱개 환산)을 먼저 채운다(모자라면 부족분 비례). 세트 수는 내림.
//  - 부족분을 다 채우고 남는 몫은 SKU 30일 판매 비중으로 나눈다. 판매도 없으면 낱개로 남긴다.
//  - 내림으로 남은 낱개는 그 옵션만 담는 ×1 SKU(가중치 큰 순)에 준다. 없으면 낱개로 남긴다.
//  - Σ(배분 세트 × 구성 수량) ≤ 옵션 몫 이 항상 성립한다.
// ponytail: 여러 옵션을 섞은 SKU 는 옵션별 몫 중 가장 작은 세트 수만 받는다(보수적). 섞인 SKU 가
// 많아지면 옵션 간 결합을 고려한 배분으로 바꾼다.

export type LinkedSkuInput = {
  code: string
  items: Array<{ optionId: string; perSet: number }>
  /** 판매 가능 재고(세트 단위) */
  stock: number
  /** 입고 예정(세트 단위) */
  inbound: number
  /** 최근 30일 판매(세트 단위) */
  sales30d: number
}

export type LinkedSkuAllocation = {
  code: string
  needSets: number
  allocSets: number
}

export type LinkedSkuAllocationResult = {
  skus: LinkedSkuAllocation[]
  /** SKU 로 묶이지 않고 낱개로 남은 연동 위치 몫 */
  looseByOption: Map<string, number>
}

export function allocateLinkedSkus(
  skus: LinkedSkuInput[],
  linkedQtyByOption: Map<string, number>,
  horizonDays: number
): LinkedSkuAllocationResult {
  const valid = skus.filter((s) => s.items.length > 0 && s.items.every((it) => it.perSet > 0))
  const needSets = new Map(
    valid.map((s) => [
      s.code,
      Math.max(
        0,
        Math.ceil((Math.max(0, s.sales30d) / 30) * horizonDays) -
          Math.max(0, s.stock) -
          Math.max(0, s.inbound)
      ),
    ])
  )

  // 옵션별로 SKU 가중치(낱개 환산)를 정하고, SKU 별 후보 세트 수를 구한다.
  const candidate = new Map<string, number[]>() // code → 옵션별 후보 세트 수
  const weightOf = new Map<string, Map<string, number>>() // optionId → code → 가중치
  for (const [optionId, budgetRaw] of linkedQtyByOption) {
    const budget = Math.max(0, Math.floor(budgetRaw))
    const holders = valid.filter((s) => s.items.some((it) => it.optionId === optionId))
    const perSetOf = (s: LinkedSkuInput) => s.items.find((it) => it.optionId === optionId)!.perSet
    // 1) 부족분(낱개)을 먼저 채운다 — 몫이 모자라면 부족분 비례로 줄인다.
    const needUnits = holders.map((s) => (needSets.get(s.code) ?? 0) * perSetOf(s))
    const needTotal = needUnits.reduce((a, b) => a + b, 0)
    const phase1 = Math.min(budget, needTotal)
    // 2) 부족분을 다 채우고 남는 몫(옵션 단위 예측·안전재고분)은 SKU 30일 판매 비중으로 나눈다.
    const salesUnits = holders.map((s) => Math.max(0, s.sales30d) * perSetOf(s))
    const salesTotal = salesUnits.reduce((a, b) => a + b, 0)
    const excess = budget - phase1
    const desired = holders.map(
      (_, i) =>
        (needTotal > 0 ? (phase1 * needUnits[i]) / needTotal : 0) +
        (salesTotal > 0 ? (excess * salesUnits[i]) / salesTotal : 0)
    )
    const wm = new Map<string, number>()
    holders.forEach((s, i) => {
      wm.set(s.code, needUnits[i] + salesUnits[i])
      const sets = Math.floor(desired[i] / perSetOf(s))
      const arr = candidate.get(s.code) ?? []
      arr.push(sets)
      candidate.set(s.code, arr)
    })
    weightOf.set(optionId, wm)
  }

  const alloc = new Map<string, number>()
  for (const s of valid) {
    const c = candidate.get(s.code)
    // 몫이 없는 옵션이 섞인 SKU 는 받을 수 없다.
    const hasAllBudgets = s.items.every((it) => linkedQtyByOption.has(it.optionId))
    alloc.set(s.code, c && hasAllBudgets ? Math.min(...c) : 0)
  }

  // 남은 낱개 → 그 옵션만 담는 ×1 SKU(가중치 큰 순), 없으면 낱개로 남김.
  const looseByOption = new Map<string, number>()
  for (const [optionId, budgetRaw] of linkedQtyByOption) {
    const budget = Math.max(0, Math.floor(budgetRaw))
    const used = valid.reduce((sum, s) => {
      const it = s.items.find((x) => x.optionId === optionId)
      return it ? sum + (alloc.get(s.code) ?? 0) * it.perSet : sum
    }, 0)
    const rest = budget - used
    if (rest <= 0) continue
    const wm = weightOf.get(optionId)
    const single = valid
      .filter(
        (s) => s.items.length === 1 && s.items[0].optionId === optionId && s.items[0].perSet === 1
      )
      .sort((a, b) => (wm?.get(b.code) ?? 0) - (wm?.get(a.code) ?? 0) || b.sales30d - a.sales30d)[0]
    if (single && ((wm?.get(single.code) ?? 0) > 0 || single.sales30d > 0)) {
      alloc.set(single.code, (alloc.get(single.code) ?? 0) + rest)
    } else {
      looseByOption.set(optionId, rest)
    }
  }

  return {
    skus: valid.map((s) => ({
      code: s.code,
      needSets: needSets.get(s.code) ?? 0,
      allocSets: alloc.get(s.code) ?? 0,
    })),
    looseByOption,
  }
}
