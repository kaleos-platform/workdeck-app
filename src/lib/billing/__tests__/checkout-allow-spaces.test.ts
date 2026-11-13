/** @jest-environment node */
import { assertCheckoutOpen } from '../subscription-service'
import { isCheckoutPausedFor } from '../entitlement'

jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('../providers/toss', () => ({ getBillingProvider: jest.fn() }))

const CLOSED = ['seller-hub']

describe('assertCheckoutOpen — 결제 중지 중 허용 공간', () => {
  afterEach(() => {
    delete process.env.BILLING_CHECKOUT_PAUSED
    delete process.env.BILLING_CHECKOUT_ALLOW_SPACES
  })

  it('중지 중이면 목록에 없는 공간은 503', () => {
    process.env.BILLING_CHECKOUT_PAUSED = '1'
    process.env.BILLING_CHECKOUT_ALLOW_SPACES = 'space_review, space_other'
    expect(() => assertCheckoutOpen('space_customer', CLOSED)).toThrow(
      expect.objectContaining({ status: 503 })
    )
  })

  it('중지 중이어도 허용 공간은 통과 (공백 무시)', () => {
    process.env.BILLING_CHECKOUT_PAUSED = '1'
    process.env.BILLING_CHECKOUT_ALLOW_SPACES = 'space_other, space_review'
    expect(() => assertCheckoutOpen('space_review', CLOSED)).not.toThrow()
  })

  it('허용 목록이 비어 있으면 빈 spaceId도 통과시키지 않는다', () => {
    process.env.BILLING_CHECKOUT_PAUSED = '1'
    expect(() => assertCheckoutOpen('', CLOSED)).toThrow(expect.objectContaining({ status: 503 }))
  })

  it('중지가 아니면 누구나 통과', () => {
    expect(() => assertCheckoutOpen('space_customer', CLOSED)).not.toThrow()
  })

  it('잠금 보류 판정도 허용 공간만 중지에서 뺀다', () => {
    process.env.BILLING_CHECKOUT_PAUSED = '1'
    process.env.BILLING_CHECKOUT_ALLOW_SPACES = 'space_review'
    expect(isCheckoutPausedFor('space_review', CLOSED)).toBe(false)
    expect(isCheckoutPausedFor('space_customer', CLOSED)).toBe(true)
  })

  it('모집 관리만 고르면 중지 중에도 결제·잠금 판정이 열린다', () => {
    process.env.BILLING_CHECKOUT_PAUSED = '1'
    expect(() => assertCheckoutOpen('space_customer', ['recruiting'])).not.toThrow()
    expect(isCheckoutPausedFor('space_customer', ['recruiting'])).toBe(false)
  })

  it('닫힌 업무가 섞이거나 업무가 없으면 중지 유지', () => {
    process.env.BILLING_CHECKOUT_PAUSED = '1'
    expect(() => assertCheckoutOpen('space_customer', ['recruiting', 'seller-hub'])).toThrow(
      expect.objectContaining({ status: 503 })
    )
    expect(isCheckoutPausedFor('space_customer', [])).toBe(true)
  })
})
