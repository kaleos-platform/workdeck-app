/**
 * 외부 옵션 브리지의 순수 계산부 — DB 의존 없음.
 *
 * 로딩(prisma)은 external-option-bridge.ts 가 담당한다. 배분 산식만 여기 두어
 * 유닛 테스트가 Prisma 런타임을 끌어오지 않게 한다.
 */

/** 외부코드 1건이 내부 옵션들로 갈라지는 비율. weight 합은 1. */
export type BridgeAllocation = { optionId: string; weight: number }

export type ExternalOptionBridge = {
  /** 외부 optionId → 내부 옵션 배분 비율 */
  byExternalOptionId: Map<string, BridgeAllocation[]>
  stats: {
    /** optionId·skuId 를 동시에 가진 사전 행 수 */
    dictEntries: number
    /** 내부 옵션으로 이어진 외부 optionId 수 */
    bridgedExternalOptions: number
  }
}

export const EMPTY_BRIDGE: ExternalOptionBridge = {
  byExternalOptionId: new Map(),
  stats: { dictEntries: 0, bridgedExternalOptions: 0 },
}

/**
 * 외부 옵션ID 기준 금액을 내부 옵션으로 배분한다.
 * 매핑이 없으면 배분하지 않고 unbridged 로 합산한다(추정 배분 금지).
 * 팬아웃 시에도 금액 합은 보존된다 — 단순 조인은 옵션 수만큼 중복 계상된다.
 */
export function allocateByBridge(
  bridge: ExternalOptionBridge,
  entries: Iterable<{ externalOptionId: string | null; amount: number; quantity?: number }>
): { byOption: Map<string, { amount: number; quantity: number }>; unbridgedAmount: number } {
  const byOption = new Map<string, { amount: number; quantity: number }>()
  let unbridgedAmount = 0

  for (const e of entries) {
    const alloc = e.externalOptionId ? bridge.byExternalOptionId.get(e.externalOptionId) : undefined
    if (!alloc || alloc.length === 0) {
      unbridgedAmount += e.amount
      continue
    }
    for (const a of alloc) {
      const cur = byOption.get(a.optionId) ?? { amount: 0, quantity: 0 }
      cur.amount += e.amount * a.weight
      cur.quantity += (e.quantity ?? 0) * a.weight
      byOption.set(a.optionId, cur)
    }
  }

  return { byOption, unbridgedAmount }
}
