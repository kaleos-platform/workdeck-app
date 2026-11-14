/** @jest-environment node */
import { NextResponse } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import {
  getSubscriptionAccessOverview,
  updateSubscriptionAccess,
  SubscriptionAdminError,
} from '@/lib/billing/subscription-admin'
import { GET } from '../route'
import { PATCH } from '../[spaceId]/[deckAppId]/route'

jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn() }))
jest.mock('@/lib/billing/subscription-admin', () => ({
  getSubscriptionAccessOverview: jest.fn(),
  updateSubscriptionAccess: jest.fn(),
  SubscriptionAdminError: class extends Error {
    constructor(
      public status: number,
      message: string
    ) {
      super(message)
    }
  },
}))
const params = Promise.resolve({ spaceId: 's', deckAppId: 'inv' })
const request = (body: unknown) =>
  new Request('http://localhost/api/admin/subscriptions/s/inv', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
beforeEach(() => {
  jest.clearAllMocks()
  ;(requireOperator as jest.Mock).mockResolvedValue({ ok: true, user: { id: 'op' } })
})

test.each([404, 403])('GET/PATCH는 운영자·MFA 거절 응답을 그대로 반환한다: %s', async (status) => {
  ;(requireOperator as jest.Mock).mockResolvedValue({
    ok: false,
    response: NextResponse.json({ message: 'denied' }, { status }),
  })
  expect((await GET()).status).toBe(status)
  expect((await PATCH(request({ exempt: true, note: '지원' }), { params })).status).toBe(status)
  expect(getSubscriptionAccessOverview).not.toHaveBeenCalled()
  expect(updateSubscriptionAccess).not.toHaveBeenCalled()
})

test('혼합 명령·빈 사유·불가능한 날짜를 DB 접근 전에 거절한다', async () => {
  for (const body of [
    { exempt: true, trialEndsOn: '2026-11-30', note: '지원' },
    { exempt: true, note: '  ' },
    { trialEndsOn: '2026-02-30', note: '지원' },
  ]) {
    expect((await PATCH(request(body), { params })).status).toBe(400)
  }
  expect(updateSubscriptionAccess).not.toHaveBeenCalled()
})

test('변경 사유를 trim하고 인증한 운영자와 정확한 대상을 서비스에 전달한다', async () => {
  ;(updateSubscriptionAccess as jest.Mock).mockResolvedValue({ exemptFlag: true })
  expect((await PATCH(request({ exempt: true, note: ' 지원 ' }), { params })).status).toBe(200)
  expect(updateSubscriptionAccess).toHaveBeenCalledWith('op', 's', 'inv', {
    exempt: true,
    note: '지원',
  })
})

test('서비스 충돌과 잘못된 대상은 안전한 상태 코드로 반환한다', async () => {
  for (const status of [404, 409]) {
    ;(updateSubscriptionAccess as jest.Mock).mockRejectedValue(
      new SubscriptionAdminError(status, '안내')
    )
    const response = await PATCH(request({ exempt: true, note: '지원' }), { params })
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ message: '안내' })
  }
})

test('예상하지 못한 DB 오류는 내부 내용을 노출하지 않는다', async () => {
  ;(updateSubscriptionAccess as jest.Mock).mockRejectedValue(
    new Error('database password sensitive')
  )
  const response = await PATCH(request({ exempt: true, note: '지원' }), { params })
  expect(response.status).toBe(500)
  expect(JSON.stringify(await response.json())).not.toContain('password')
  ;(getSubscriptionAccessOverview as jest.Mock).mockRejectedValue(
    new Error('database password sensitive')
  )
  expect((await GET()).status).toBe(500)
})
