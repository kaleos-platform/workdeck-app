import { allocateByBridge, type ExternalOptionBridge } from '@/lib/sh/external-option-alloc'

const bridge = (entries: Record<string, { optionId: string; weight: number }[]>) =>
  ({
    byExternalOptionId: new Map(Object.entries(entries)),
    stats: { dictEntries: 0, bridgedExternalOptions: Object.keys(entries).length },
  }) satisfies ExternalOptionBridge

describe('allocateByBridge', () => {
  it('매핑된 외부 옵션의 금액을 내부 옵션으로 옮긴다', () => {
    const b = bridge({ '92143176219': [{ optionId: 'optA', weight: 1 }] })

    const { byOption, unbridgedAmount } = allocateByBridge(b, [
      { externalOptionId: '92143176219', amount: 1000, quantity: 5 },
    ])

    expect(unbridgedAmount).toBe(0)
    expect(byOption.get('optA')).toEqual({ amount: 1000, quantity: 5 })
  })

  it('팬아웃 시 금액 합이 보존된다 (중복 계상 금지)', () => {
    // 한 외부코드가 두 내부 옵션으로 갈라지는 세트 구성.
    const b = bridge({
      ext1: [
        { optionId: 'optA', weight: 0.5 },
        { optionId: 'optB', weight: 0.5 },
      ],
    })

    const { byOption } = allocateByBridge(b, [
      { externalOptionId: 'ext1', amount: 1000, quantity: 10 },
    ])

    const total = [...byOption.values()].reduce((s, v) => s + v.amount, 0)
    expect(total).toBe(1000)
    expect(byOption.get('optA')?.amount).toBe(500)
    expect(byOption.get('optB')?.amount).toBe(500)
    expect(byOption.get('optA')?.quantity).toBe(5)
  })

  it('비대칭 가중치도 합이 보존된다', () => {
    const b = bridge({
      ext1: [
        { optionId: 'optA', weight: 2 / 3 },
        { optionId: 'optB', weight: 1 / 3 },
      ],
    })

    const { byOption } = allocateByBridge(b, [{ externalOptionId: 'ext1', amount: 900 }])

    expect(byOption.get('optA')?.amount).toBeCloseTo(600, 6)
    expect(byOption.get('optB')?.amount).toBeCloseTo(300, 6)
  })

  it('매핑이 없으면 배분하지 않고 unbridged 로 남긴다 (추정 배분 금지)', () => {
    const b = bridge({ ext1: [{ optionId: 'optA', weight: 1 }] })

    const { byOption, unbridgedAmount } = allocateByBridge(b, [
      { externalOptionId: 'ext1', amount: 100 },
      { externalOptionId: 'unknown', amount: 250 },
      { externalOptionId: null, amount: 50 },
    ])

    expect(byOption.get('optA')?.amount).toBe(100)
    expect(unbridgedAmount).toBe(300)
    expect(byOption.size).toBe(1)
  })

  it('빈 배분 목록은 매핑 없음과 동일하게 처리한다', () => {
    const b = bridge({ ext1: [] })

    const { byOption, unbridgedAmount } = allocateByBridge(b, [
      { externalOptionId: 'ext1', amount: 400 },
    ])

    expect(byOption.size).toBe(0)
    expect(unbridgedAmount).toBe(400)
  })
})
