/** @jest-environment node */
jest.mock('@/lib/admin/auth', () => ({
  requireOperator: jest.fn(),
  writeAuditLog: jest.fn(),
}))

import { NextResponse, type NextRequest } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { POST } from '../route'

const call = (body: unknown) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as NextRequest)

beforeEach(() => jest.clearAllMocks())

test('운영자의 account.mfa.replace 는 기록한다(aal1 MFA_REQUIRED 여도)', async () => {
  ;(requireOperator as jest.Mock).mockResolvedValue({
    ok: false,
    reason: 'MFA_REQUIRED',
    user: { id: 'op-1' },
  })
  const res = await call({ action: 'account.mfa.replace' })
  expect(res.status).toBe(204)
  expect(writeAuditLog).toHaveBeenCalledWith('op-1', 'account.mfa.replace', 'user', 'op-1')
})

test('비운영자는 404 그대로, 기록 없음', async () => {
  ;(requireOperator as jest.Mock).mockResolvedValue({
    ok: false,
    reason: 'NOT_OPERATOR',
    response: NextResponse.json({}, { status: 404 }),
  })
  const res = await call({ action: 'account.mfa.replace' })
  expect(res.status).toBe(404)
  expect(writeAuditLog).not.toHaveBeenCalled()
})

test('허용 목록 밖 action 은 400', async () => {
  ;(requireOperator as jest.Mock).mockResolvedValue({ ok: true, user: { id: 'op-1' } })
  const res = await call({ action: 'account.mfa.whatever' })
  expect(res.status).toBe(400)
})
