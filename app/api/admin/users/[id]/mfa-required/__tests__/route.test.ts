/** @jest-environment node */
jest.mock('@/lib/admin/auth', () => ({
  requireOperator: jest.fn(),
  writeAuditLog: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}))

import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { prisma } from '@/lib/prisma'
import { POST } from '../route'

const m = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock }
  $transaction: jest.Mock
}
const call = (body: unknown) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'u-2' }),
  })

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireOperator as jest.Mock).mockResolvedValue({ ok: true, user: { id: 'op-1' } })
  m.user.findUnique.mockResolvedValue({ id: 'u-2', email: 'a@b.c', platformRole: 'USER' })
  m.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m))
})

it('운영자가 아니면 그 응답을 그대로 돌려준다', async () => {
  ;(requireOperator as jest.Mock).mockResolvedValue({
    ok: false,
    response: new Response(null, { status: 403 }),
  })
  expect((await call({ mfaRequired: true })).status).toBe(403)
  expect(m.user.update).not.toHaveBeenCalled()
})

it('대상이 없으면 404', async () => {
  m.user.findUnique.mockResolvedValue(null)
  expect((await call({ mfaRequired: true })).status).toBe(404)
})

it('운영자 대상은 400이고 변경·감사 없음', async () => {
  m.user.findUnique.mockResolvedValue({ id: 'u-2', email: 'a@b.c', platformRole: 'OPERATOR' })
  expect((await call({ mfaRequired: false })).status).toBe(400)
  expect(m.user.update).not.toHaveBeenCalled()
  expect(writeAuditLog).not.toHaveBeenCalled()
})

it('잘못된 본문은 422', async () => {
  expect((await call({ mfaRequired: 'yes' })).status).toBe(422)
  expect((await call({})).status).toBe(422)
})

it('켜면 트랜잭션 안에서 update + 감사(tx 전달)', async () => {
  const res = await call({ mfaRequired: true })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, mfaRequired: true })
  expect(m.user.update).toHaveBeenCalledWith({
    where: { id: 'u-2' },
    data: { mfaRequired: true },
  })
  expect(writeAuditLog).toHaveBeenCalledWith(
    'op-1',
    'user.mfa_required.on',
    'user',
    'u-2',
    { email: 'a@b.c' },
    m
  )
})

it('끄면 감사 action 은 off', async () => {
  await call({ mfaRequired: false })
  expect((writeAuditLog as jest.Mock).mock.calls[0][1]).toBe('user.mfa_required.off')
})

it('감사가 throw 하면 핸들러가 reject 된다(트랜잭션 롤백, ok 응답 없음)', async () => {
  ;(writeAuditLog as jest.Mock).mockRejectedValue(new Error('audit fail'))
  await expect(call({ mfaRequired: true })).rejects.toThrow('audit fail')
})
