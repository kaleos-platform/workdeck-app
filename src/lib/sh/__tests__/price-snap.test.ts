// @jest-environment node
// snapPrice 단위 테스트

import { snapPrice } from '../price-snap'

describe('snapPrice — end900', () => {
  test('24350 → 24900', () => {
    expect(snapPrice(24350, 'end900')).toBe(24900)
  })

  test('24900 → 24900 (이미 end900)', () => {
    expect(snapPrice(24900, 'end900')).toBe(24900)
  })

  test('24000 → 24900 (000으로 끝나는 경우)', () => {
    expect(snapPrice(24000, 'end900')).toBe(24900)
  })

  test('24901 → 25900 (900 바로 위)', () => {
    expect(snapPrice(24901, 'end900')).toBe(25900)
  })

  test('0 → 900', () => {
    expect(snapPrice(0, 'end900')).toBe(900)
  })

  test('1 → 900', () => {
    expect(snapPrice(1, 'end900')).toBe(900)
  })

  test('1000 → 1900', () => {
    expect(snapPrice(1000, 'end900')).toBe(1900)
  })

  test('999 → 999? No — 999 < 900+floor(999/1000)*1000 = 900, so 900 >= 999 is false → 1900', () => {
    // base = floor(999/1000)*1000 + 900 = 0 + 900 = 900
    // 900 >= 999? No → 900 + 1000 = 1900
    expect(snapPrice(999, 'end900')).toBe(1900)
  })
})

describe('snapPrice — end000', () => {
  test('24350 → 25000', () => {
    expect(snapPrice(24350, 'end000')).toBe(25000)
  })

  test('24000 → 24000 (이미 1000단위)', () => {
    expect(snapPrice(24000, 'end000')).toBe(24000)
  })

  test('24001 → 25000', () => {
    expect(snapPrice(24001, 'end000')).toBe(25000)
  })

  test('1 → 1000', () => {
    expect(snapPrice(1, 'end000')).toBe(1000)
  })
})

describe('snapPrice — none', () => {
  test('24350.6 → 24351 (정수 반올림)', () => {
    expect(snapPrice(24350.6, 'none')).toBe(24351)
  })

  test('24000 → 24000', () => {
    expect(snapPrice(24000, 'none')).toBe(24000)
  })
})

describe('snapPrice — 가드 케이스', () => {
  test('NaN → 0', () => {
    expect(snapPrice(NaN, 'end900')).toBe(0)
    expect(snapPrice(NaN, 'end000')).toBe(0)
    expect(snapPrice(NaN, 'none')).toBe(0)
  })

  test('음수 → 0', () => {
    expect(snapPrice(-100, 'end900')).toBe(0)
    expect(snapPrice(-1, 'end000')).toBe(0)
  })

  test('Infinity → 0', () => {
    expect(snapPrice(Infinity, 'end900')).toBe(0)
    expect(snapPrice(-Infinity, 'end000')).toBe(0)
  })
})
