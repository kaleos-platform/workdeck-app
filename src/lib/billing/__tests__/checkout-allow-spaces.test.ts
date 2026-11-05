/** @jest-environment node */
import { assertCheckoutOpen } from '../subscription-service'

jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('../providers/toss', () => ({ getBillingProvider: jest.fn() }))

describe('assertCheckoutOpen — 결제 중지 중 허용 공간', () => {
  afterEach(() => {
    delete process.env.BILLING_CHECKOUT_PAUSED
    delete process.env.BILLING_CHECKOUT_ALLOW_SPACES
  })

  it('중지 중이면 목록에 없는 공간은 503', () => {
    process.env.BILLING_CHECKOUT_PAUSED = '1'
    process.env.BILLING_CHECKOUT_ALLOW_SPACES = 'space_review, space_other'
    expect(() => assertCheckoutOpen('space_customer')).toThrow(
      expect.objectContaining({ status: 503 })
    )
  })

  it('중지 중이어도 허용 공간은 통과 (공백 무시)', () => {
    process.env.BILLING_CHECKOUT_PAUSED = '1'
    process.env.BILLING_CHECKOUT_ALLOW_SPACES = 'space_other, space_review'
    expect(() => assertCheckoutOpen('space_review')).not.toThrow()
  })

  it('허용 목록이 비어 있으면 빈 spaceId도 통과시키지 않는다', () => {
    process.env.BILLING_CHECKOUT_PAUSED = '1'
    expect(() => assertCheckoutOpen('')).toThrow(expect.objectContaining({ status: 503 }))
  })

  it('중지가 아니면 누구나 통과', () => {
    expect(() => assertCheckoutOpen('space_customer')).not.toThrow()
  })
})
