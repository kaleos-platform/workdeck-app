/** @jest-environment node */
import { NextResponse } from 'next/server'
import { PATCH } from '../route'
import { prisma } from '@/lib/prisma'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'

jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn(), writeAuditLog: jest.fn() }))
jest.mock('@/lib/prisma', () => {
  const p = { userFeedback: { findUnique: jest.fn(), update: jest.fn() }, $transaction: jest.fn() }
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p))
  return { prisma: p }
})

const call = (body: unknown, id = 'f1') =>
  PATCH(
    new Request('https://admin.test/api/admin/feedback/f1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  )
const closed = new Date('2026-11-01T00:00:00Z')

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(requireOperator).mockResolvedValue({ ok: true, user: { id: 'op', email: 'o@x.com' } } as never)
  jest
    .mocked(prisma.userFeedback.findUnique)
    .mockResolvedValue({ id: 'f1', status: 'DONE', closedAt: closed } as never)
  jest.mocked(prisma.userFeedback.update).mockImplementation((async (a: { data: unknown }) => ({ id: 'f1', ...(a.data as object) })) as never)
})

it('비운영자는 requireOperator 응답 그대로', async () => {
  jest.mocked(requireOperator).mockResolvedValue({
    ok: false,
    reason: 'NOT_OPERATOR',
    response: NextResponse.json({}, { status: 404 }),
  } as never)
  expect((await call({ memo: 'a' })).status).toBe(404)
  expect(prisma.userFeedback.findUnique).not.toHaveBeenCalled()
})
it('빈 본문 400, 없는 id 404', async () => {
  expect((await call({})).status).toBe(400)
  jest.mocked(prisma.userFeedback.findUnique).mockResolvedValue(null)
  expect((await call({ memo: 'a' })).status).toBe(404)
  expect(prisma.userFeedback.update).not.toHaveBeenCalled()
})
it('DONE→IN_PROGRESS면 closedAt null', async () => {
  expect((await call({ status: 'IN_PROGRESS' })).status).toBe(200)
  expect(jest.mocked(prisma.userFeedback.update).mock.calls[0][0].data).toMatchObject({
    status: 'IN_PROGRESS',
    closedAt: null,
  })
})
it('메모만 변경하면 closedAt을 쓰지 않는다', async () => {
  await call({ memo: '메모' })
  const data = jest.mocked(prisma.userFeedback.update).mock.calls[0][0].data
  expect('closedAt' in data).toBe(false)
  expect(data.memo).toBe('메모')
})
it('감사 로그는 같은 tx로 기록하고 meta에 본문이 없다', async () => {
  await call({ status: 'ON_HOLD', memo: '비밀 메모' })
  const args = jest.mocked(writeAuditLog).mock.calls[0]
  expect(args.slice(0, 5)).toEqual([
    'op',
    'userFeedback.update',
    'userFeedback',
    'f1',
    { status: 'ON_HOLD', memoChanged: true },
  ])
  expect(args[5]).toBe(prisma)
  expect(JSON.stringify(args)).not.toContain('비밀 메모')
})
it('감사 로그가 throw하면 전체가 실패(롤백은 tx가 담당)', async () => {
  jest.mocked(writeAuditLog).mockRejectedValue(new Error('audit'))
  await expect(call({ memo: 'a' })).rejects.toThrow('audit')
})
