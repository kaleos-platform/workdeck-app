import fixtures from './fixtures/product-orders.json'
import { toProductOrder } from '../client'
import { EXCLUDED_STATUSES, isNbaesong, kstDay, nbaesongItemName } from '../nbaesong'

describe('isNbaesong', () => {
  it('aml 전부 true', () =>
    fixtures.aml.forEach((r) => expect(isNbaesong(toProductOrder(r))).toBe(true)))
  it('일반배송 전부 false', () =>
    fixtures.kreamdNormal.forEach((r) => expect(isNbaesong(toProductOrder(r))).toBe(false)))
  it('ARRIVAL_GUARANTEE + logisticsCompanyId null → false', () => {
    const po = { ...toProductOrder(fixtures.aml[0]), logisticsCompanyId: null }
    expect(isNbaesong(po)).toBe(false)
  })
})

describe('kstDay', () => {
  it('KST 일자', () => {
    expect(kstDay('2026-10-24T23:59:00+09:00')).toBe('2026-10-24')
    expect(kstDay('2026-10-25T00:00:30+09:00')).toBe('2026-10-25')
    expect(kstDay('2026-10-24T15:00:30Z')).toBe('2026-10-25')
  })
})

it('nbaesongItemName = productName', () => {
  const po = toProductOrder(fixtures.aml[0])
  expect(nbaesongItemName(po)).toBe(po.productName)
})

it('취소 상태는 제외 대상', () => {
  expect(EXCLUDED_STATUSES.has(toProductOrder(fixtures.amlCancel[0]).productOrderStatus)).toBe(true)
})
