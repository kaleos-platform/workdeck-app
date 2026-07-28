import {
  calcAmounts,
  sumLines,
  prorate,
  remainingDaysBetween,
  cycleOrderId,
  prorateOrderId,
} from '../pricing'
import { DECK_META, type DeckVariant } from '@/lib/deck-meta'

describe('calcAmounts / sumLines', () => {
  test('VAT 별도: 공급가 × 1.1', () => {
    expect(calcAmounts(29000)).toEqual({ supplyAmount: 29000, vatAmount: 2900, amount: 31900 })
  })

  test('deck 2종 합산 청구', () => {
    const r = sumLines([
      { deckAppId: 'coupang-ads', type: 'DECK', price: 29000 },
      { deckAppId: 'finance', type: 'DECK', price: 19000 },
    ])
    expect(r).toEqual({ supplyAmount: 48000, vatAmount: 4800, amount: 52800 })
  })

  test('빈 라인 = 0원', () => {
    expect(sumLines([])).toEqual({ supplyAmount: 0, vatAmount: 0, amount: 0 })
  })
})

describe('prorate', () => {
  test('반 주기 남으면 절반 청구', () => {
    expect(prorate(29000, 15, 30)).toBe(14500)
  })

  test('당일 추가(0일 미만 방지)도 최소 1일 청구', () => {
    expect(prorate(29000, 0, 30)).toBe(Math.round(29000 / 30))
  })

  test('남은 일수가 주기 초과면 전액 상한', () => {
    expect(prorate(29000, 45, 30)).toBe(29000)
  })
})

describe('remainingDaysBetween', () => {
  test('부분일 올림', () => {
    const now = new Date('2026-08-01T12:00:00Z')
    const end = new Date('2026-08-05T00:00:00Z')
    expect(remainingDaysBetween(now, end)).toBe(4) // 3.5일 → 4
  })

  test('기간 지남 = 0', () => {
    expect(
      remainingDaysBetween(new Date('2026-08-10T00:00:00Z'), new Date('2026-08-01T00:00:00Z'))
    ).toBe(0)
  })
})

describe('orderId 멱등키', () => {
  test('cycleOrderId는 구독×주기시작시각 단위 결정적', () => {
    const id = cycleOrderId('sub123', new Date('2026-08-01T09:30:15Z'))
    expect(id).toBe('sub_sub123_20260801093015')
    // 같은 입력 → 같은 키 (cron 재실행 멱등), 다른 주기 → 다른 키
    expect(cycleOrderId('sub123', new Date('2026-08-01T09:30:15Z'))).toBe(id)
    expect(cycleOrderId('sub123', new Date('2026-09-01T09:30:15Z'))).not.toBe(id)
  })

  test('prorateOrderId는 아이템 단위 결정적', () => {
    expect(prorateOrderId('item9', new Date('2026-08-05T00:00:00Z'))).toBe('prorate_item9_20260805')
  })
})

// DeckApp.id(시드/BillingDeckProduct 키)와 deck-meta DeckVariant 키 정합성 가드.
// 과금 카탈로그 6종이 전부 DECK_META에 존재해야 UI 매핑이 깨지지 않는다.
describe('BillingDeckProduct ↔ DeckVariant 키 정합', () => {
  const BILLING_DECK_IDS = [
    'coupang-ads',
    'seller-hub',
    'finance',
    'sales-content',
    'recruiting',
    'blog-ops',
  ]

  test('과금 deck id 전부 DECK_META에 존재', () => {
    for (const id of BILLING_DECK_IDS) {
      expect(DECK_META[id as DeckVariant]).toBeDefined()
    }
  })
})
