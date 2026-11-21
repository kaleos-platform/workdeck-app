import { ObserveSettingBodySchema, parseMatchRule } from '../types'

describe('주문 관측 설정 입력 검증', () => {
  const base = { observeEnabled: true, adapter: 'cafe24' as const, storeKey: 'myshop24' }
  it('reconcileMode 는 diagnose|judge 만', () => {
    expect(ObserveSettingBodySchema.safeParse({ ...base, reconcileMode: 'judge' }).success).toBe(
      true
    )
    expect(ObserveSettingBodySchema.safeParse({ ...base, reconcileMode: 'x' }).success).toBe(false)
  })
  it('matchKeyRule 은 허용된 field 만, 추가 키 거부', () => {
    const ok = (v: unknown) =>
      ObserveSettingBodySchema.safeParse({ ...base, matchKeyRule: v }).success
    expect(ok({ field: 'lineKeyOrderPart' })).toBe(true)
    expect(ok(null)).toBe(true)
    expect(ok({ field: 'recipientName' })).toBe(false)
    expect(ok({ field: 'externalOrderId', extra: 1 })).toBe(false)
  })
  it('카페24 는 켤 때 쇼핑몰(storeKey) 필수, 끌 때는 생략 가능', () => {
    const noKey = { observeEnabled: true, adapter: 'cafe24' as const }
    expect(ObserveSettingBodySchema.safeParse(noKey).success).toBe(false)
    expect(ObserveSettingBodySchema.safeParse({ ...noKey, observeEnabled: false }).success).toBe(
      true
    )
  })
  it('parseMatchRule: 형식이 깨진 저장값은 null(=C)', () => {
    expect(parseMatchRule({ field: 'externalLineKey' })).toEqual({ field: 'externalLineKey' })
    expect(parseMatchRule({ field: 'bogus' })).toBeNull()
    expect(parseMatchRule('x')).toBeNull()
    expect(parseMatchRule(null)).toBeNull()
  })
})
