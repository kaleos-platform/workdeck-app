import {
  evaluateDeckAccess,
  GRACE_DAYS,
  type DeckAccessInput,
  type DeckProductInput,
  type SubscriptionInput,
} from '../entitlement-core'

const NOW = new Date('2026-08-01T00:00:00Z')

function product(overrides: Partial<DeckProductInput> = {}): DeckProductInput {
  return {
    id: 'coupang-ads',
    pricingMode: 'SUBSCRIPTION',
    paidActivatedAt: new Date('2026-07-01T00:00:00Z'),
    isActive: true,
    ...overrides,
  }
}

function sub(overrides: Partial<SubscriptionInput> = {}): SubscriptionInput {
  return {
    status: 'ACTIVE',
    trialEndsAt: null,
    currentPeriodEnd: new Date('2026-08-15T00:00:00Z'),
    exemptFlag: false,
    activeDeckItemIds: [],
    ...overrides,
  }
}

function evaluate(input: Partial<DeckAccessInput>) {
  return evaluateDeckAccess({
    product: product(),
    subscription: null,
    deckInstanceCreatedAt: null,
    now: NOW,
    ...input,
  })
}

describe('evaluateDeckAccess', () => {
  test('FREE_BETA deck은 구독 없이도 허용', () => {
    const r = evaluate({ product: product({ pricingMode: 'FREE_BETA' }) })
    expect(r).toEqual({ allowed: true, reason: 'FREE_BETA' })
  })

  test('면제 플래그 Space는 유료 deck 허용', () => {
    const r = evaluate({ subscription: sub({ status: 'EXPIRED', exemptFlag: true }) })
    expect(r).toEqual({ allowed: true, reason: 'EXEMPT' })
  })

  test('ACTIVE 구독 + 해당 deck 아이템 → 허용', () => {
    const r = evaluate({ subscription: sub({ activeDeckItemIds: ['coupang-ads'] }) })
    expect(r).toEqual({ allowed: true, reason: 'SUBSCRIBED' })
  })

  test('ACTIVE 구독이라도 미구독 deck은 잠금', () => {
    const r = evaluate({ subscription: sub({ activeDeckItemIds: ['finance'] }) })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('LOCKED')
  })

  test('PAST_DUE(dunning 중)는 구독 deck full 유지', () => {
    const r = evaluate({
      subscription: sub({ status: 'PAST_DUE', activeDeckItemIds: ['coupang-ads'] }),
    })
    expect(r).toEqual({ allowed: true, reason: 'SUBSCRIBED' })
  })

  test('EXPIRED 구독은 아이템 있어도 잠금', () => {
    const r = evaluate({
      subscription: sub({ status: 'EXPIRED', activeDeckItemIds: ['coupang-ads'] }),
    })
    expect(r.reason).toBe('LOCKED')
  })

  test('Trial 유효 기간 중 유료 deck 허용', () => {
    const r = evaluate({
      subscription: sub({
        status: 'TRIALING',
        trialEndsAt: new Date('2026-08-10T00:00:00Z'),
      }),
    })
    expect(r).toEqual({ allowed: true, reason: 'TRIAL' })
  })

  test('Trial 만료 후 잠금', () => {
    const r = evaluate({
      subscription: sub({
        status: 'TRIALING',
        trialEndsAt: new Date('2026-07-20T00:00:00Z'),
      }),
    })
    expect(r.reason).toBe('LOCKED')
  })

  test('유료 전환 유예: 전환 전 사용 Space는 전환+14일까지 허용', () => {
    const paidAt = new Date('2026-07-25T00:00:00Z') // NOW = 전환 +7일
    const r = evaluate({
      product: product({ paidActivatedAt: paidAt }),
      deckInstanceCreatedAt: new Date('2026-06-01T00:00:00Z'),
    })
    expect(r.allowed).toBe(true)
    expect(r.reason).toBe('GRACE')
    expect(r.graceEndsAt).toEqual(new Date(paidAt.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000))
  })

  test('유예 만료 후 잠금', () => {
    const r = evaluate({
      product: product({ paidActivatedAt: new Date('2026-07-01T00:00:00Z') }), // +14일 = 7/15 < NOW
      deckInstanceCreatedAt: new Date('2026-06-01T00:00:00Z'),
    })
    expect(r.reason).toBe('LOCKED')
  })

  test('전환 후 신규 활성화한 Space는 유예 없음', () => {
    const r = evaluate({
      product: product({ paidActivatedAt: new Date('2026-07-25T00:00:00Z') }),
      deckInstanceCreatedAt: new Date('2026-07-28T00:00:00Z'), // 전환 후 생성
    })
    expect(r.reason).toBe('LOCKED')
  })

  test('구독 레코드 자체가 없으면 유료 deck 잠금', () => {
    const r = evaluate({})
    expect(r.reason).toBe('LOCKED')
  })
})
