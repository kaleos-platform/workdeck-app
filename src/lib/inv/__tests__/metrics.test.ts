import { statusForSku, healthRatioBySku } from '../metrics'

describe('statusForSku', () => {
  it('재고 0 이하면 OUT', () => {
    expect(statusForSku(0, 100, 200)).toBe('OUT')
    expect(statusForSku(-5, 100, 200)).toBe('OUT')
  })
  it('90일 출고 0이면 OK (데이터 부족 — 과잉 오분류 방지)', () => {
    expect(statusForSku(1000, 0, 0)).toBe('OK')
  })
  it('stock < out30d이면 LOW', () => {
    expect(statusForSku(20, 50, 100)).toBe('LOW')
  })
  it('stock > out90d이면 OVER', () => {
    expect(statusForSku(500, 30, 100)).toBe('OVER')
  })
  it('정상 범위면 OK', () => {
    expect(statusForSku(80, 50, 100)).toBe('OK')
    expect(statusForSku(100, 50, 100)).toBe('OK')
  })
  it('경계값: stock === out30d이면 OK (LOW 미달 조건 불충족)', () => {
    expect(statusForSku(50, 50, 100)).toBe('OK')
  })
  it('경계값: stock === out90d이면 OK (OVER 초과 조건 불충족)', () => {
    expect(statusForSku(100, 50, 100)).toBe('OK')
  })
})

describe('healthRatioBySku', () => {
  it('SKU 단위 OK/LOW/OUT/OVER 분포', () => {
    const dist = healthRatioBySku([
      { optionId: 'a', stock: 0, out30d: 50, out90d: 100 }, // OUT
      { optionId: 'b', stock: 20, out30d: 50, out90d: 100 }, // LOW
      { optionId: 'c', stock: 80, out30d: 50, out90d: 100 }, // OK
      { optionId: 'd', stock: 500, out30d: 50, out90d: 100 }, // OVER
    ])
    expect(dist).toEqual({ ok: 1, low: 1, out: 1, over: 1, total: 4 })
  })
  it('빈 입력', () => {
    expect(healthRatioBySku([])).toEqual({ ok: 0, low: 0, out: 0, over: 0, total: 0 })
  })
  it('합산이 total과 일치', () => {
    const skus = Array.from({ length: 100 }, (_, i) => ({
      optionId: `o${i}`,
      stock: i * 5,
      out30d: 30,
      out90d: 90,
    }))
    const dist = healthRatioBySku(skus)
    expect(dist.ok + dist.low + dist.out + dist.over).toBe(dist.total)
    expect(dist.total).toBe(100)
  })
})
