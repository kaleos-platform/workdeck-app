import { allocateLinkedSkus, type LinkedSkuInput } from '../linked-sku-allocation'

const L = 'opt-L'
const sku = (code: string, perSet: number, p: Partial<LinkedSkuInput> = {}): LinkedSkuInput => ({
  code,
  items: [{ optionId: L, perSet }],
  stock: 0,
  inbound: 0,
  sales30d: 0,
  ...p,
})
const usedUnits = (r: ReturnType<typeof allocateLinkedSkus>, skus: LinkedSkuInput[]) =>
  r.skus.reduce((s, a) => s + a.allocSets * skus.find((x) => x.code === a.code)!.items[0].perSet, 0)

describe('allocateLinkedSkus', () => {
  it('누드 L 70개를 ×1/×5/×5 SKU 부족분 비례로 나누고 합계가 몫을 넘지 않는다', () => {
    const skus = [
      sku('one', 1, { sales30d: 60, stock: 20 }), // 부족 60×50/30=100-20=80세트=80개
      sku('five-a', 5, { sales30d: 6, stock: 2 }), // 10-2=8세트=40개
      sku('five-b', 5, { sales30d: 3, stock: 5 }), // 5-5=0
    ]
    const r = allocateLinkedSkus(skus, new Map([[L, 70]]), 50)
    const by = Object.fromEntries(r.skus.map((s) => [s.code, s.allocSets]))
    expect(by['five-b']).toBe(0)
    expect(by['five-a']).toBe(4) // 70×40/120=23.3개 → 4세트(20개)
    expect(by.one).toBe(50) // 46.6 → 46 + 남은 낱개 4
    expect(usedUnits(r, skus)).toBe(70)
    expect(r.looseByOption.size).toBe(0)
  })

  it('부족분이 모두 0이면 30일 판매 비중으로 나눈다', () => {
    const skus = [
      sku('one', 1, { sales30d: 10, stock: 999 }),
      sku('five', 5, { sales30d: 10, stock: 999 }),
    ]
    const r = allocateLinkedSkus(skus, new Map([[L, 60]]), 30)
    const by = Object.fromEntries(r.skus.map((s) => [s.code, s.allocSets]))
    // 가중치 10:50 → ×5 는 50개=10세트, ×1 은 10개
    expect(by.five).toBe(10)
    expect(by.one).toBe(10)
    expect(usedUnits(r, skus)).toBe(60)
  })

  it('판매도 부족분도 없으면 낱개로 남긴다', () => {
    const skus = [sku('five', 5)]
    const r = allocateLinkedSkus(skus, new Map([[L, 12]]), 30)
    expect(r.skus[0].allocSets).toBe(0)
    expect(r.looseByOption.get(L)).toBe(12)
  })

  it('×1 SKU 가 없으면 내림 나머지는 낱개로 남긴다', () => {
    const skus = [sku('five', 5, { sales30d: 30 })]
    const r = allocateLinkedSkus(skus, new Map([[L, 12]]), 30)
    expect(r.skus[0].allocSets).toBe(2)
    expect(r.looseByOption.get(L)).toBe(2)
  })

  it('몫이 없는 옵션이 섞인 SKU 는 받지 않는다', () => {
    const mixed: LinkedSkuInput = {
      code: 'mix',
      items: [
        { optionId: L, perSet: 1 },
        { optionId: 'other', perSet: 1 },
      ],
      stock: 0,
      inbound: 0,
      sales30d: 30,
    }
    const r = allocateLinkedSkus([mixed], new Map([[L, 10]]), 30)
    expect(r.skus[0].allocSets).toBe(0)
    expect(r.looseByOption.get(L)).toBe(10)
  })
})
