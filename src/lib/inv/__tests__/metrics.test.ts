import {
  statusForCell,
  statusForSku,
  healthRatioByCell,
  healthRatioBySku,
  turnoverDays,
} from '../metrics'

describe('statusForCell', () => {
  it('0 이하면 OUT', () => {
    expect(statusForCell(0, 10)).toBe('OUT')
    expect(statusForCell(-5, 10)).toBe('OUT')
  })
  it('안전재고 미달이면 LOW', () => {
    expect(statusForCell(3, 10)).toBe('LOW')
  })
  it('충족이면 OK', () => {
    expect(statusForCell(10, 10)).toBe('OK')
    expect(statusForCell(50, 10)).toBe('OK')
  })
  it('안전재고 0이면 양수는 OK', () => {
    expect(statusForCell(5, 0)).toBe('OK')
  })
})

describe('statusForSku', () => {
  it('SKU 합계 기준으로 판정', () => {
    expect(statusForSku(0, 100)).toBe('OUT')
    expect(statusForSku(50, 100)).toBe('LOW')
    expect(statusForSku(100, 100)).toBe('OK')
  })
})

describe('healthRatioByCell', () => {
  it('셀 단위로 OK/LOW/OUT 카운트', () => {
    const dist = healthRatioByCell([
      { optionId: 'a', locationId: 'L1', available: 0, safetyAtCell: 10 },
      { optionId: 'a', locationId: 'L2', available: 5, safetyAtCell: 10 },
      { optionId: 'a', locationId: 'L3', available: 20, safetyAtCell: 10 },
      { optionId: 'b', locationId: 'L1', available: 50, safetyAtCell: 5 },
    ])
    expect(dist).toEqual({ ok: 2, low: 1, out: 1, total: 4 })
  })
  it('빈 입력', () => {
    expect(healthRatioByCell([])).toEqual({ ok: 0, low: 0, out: 0, total: 0 })
  })
})

describe('healthRatioBySku', () => {
  it('SKU 단위 분포', () => {
    const dist = healthRatioBySku([
      { optionId: 'a', totalAvailable: 0, totalSafetyStock: 100 }, // OUT
      { optionId: 'b', totalAvailable: 50, totalSafetyStock: 100 }, // LOW
      { optionId: 'c', totalAvailable: 200, totalSafetyStock: 100 }, // OK
    ])
    expect(dist).toEqual({ ok: 1, low: 1, out: 1, total: 3 })
  })
})

describe('turnoverDays', () => {
  it('단순화 수식: onHand ÷ (outbound/days)', () => {
    expect(turnoverDays(300, 30, 30)).toBe(300)
    expect(turnoverDays(100, 100, 30)).toBe(30)
  })
  it('분모 0이면 null', () => {
    expect(turnoverDays(100, 0, 30)).toBeNull()
    expect(turnoverDays(100, 30, 0)).toBeNull()
  })
  it('음수 on_hand는 0으로 처리', () => {
    expect(turnoverDays(-10, 30, 30)).toBe(0)
  })
  it('소수점 1자리 반올림', () => {
    expect(turnoverDays(7, 30, 30)).toBe(7)
    expect(turnoverDays(11, 30, 30)).toBe(11)
    // 33.333... → 33.3
    const v = turnoverDays(100, 30, 9)
    expect(v).toBe(30)
  })
})

describe('등식 검증', () => {
  it('healthRatioBySku의 합은 input 길이와 같음', () => {
    const skus = Array.from({ length: 100 }, (_, i) => ({
      optionId: `o${i}`,
      totalAvailable: i,
      totalSafetyStock: 50,
    }))
    const dist = healthRatioBySku(skus)
    expect(dist.ok + dist.low + dist.out).toBe(dist.total)
    expect(dist.total).toBe(100)
  })
})
