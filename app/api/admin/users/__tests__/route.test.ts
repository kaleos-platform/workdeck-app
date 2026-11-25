/** @jest-environment node */
jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findMany: jest.fn() } } }))
jest.mock('@/lib/admin/mfa-status', () => ({ getVerifiedTotpUserIds: jest.fn() }))

import { requireOperator } from '@/lib/admin/auth'
import { getVerifiedTotpUserIds } from '@/lib/admin/mfa-status'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const findMany = (prisma as unknown as { user: { findMany: jest.Mock } }).user.findMany
const totp = getVerifiedTotpUserIds as jest.Mock
const row = (id: string, mfaRequired: boolean) => ({
  id,
  email: `${id}@x.c`,
  name: null,
  createdAt: new Date(),
  platformRole: null,
  mfaRequired,
  signupSource: null,
  spaceMemberships: [],
})
const call = (qs = '') => GET(new Request(`http://x/api/admin/users${qs}`) as never)

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireOperator as jest.Mock).mockResolvedValue({ ok: true, user: { id: 'op' } })
  findMany.mockResolvedValue([row('a', true), row('b', true)])
  totp.mockResolvedValue(new Set(['a']))
})

it('mfa=required 는 mfaRequired 또는 운영자, totpEnrolled 는 helper 기준', async () => {
  const res = await call('?mfa=required')
  expect(findMany.mock.calls[0][0].where.AND).toEqual([
    { OR: [{ mfaRequired: true }, { platformRole: 'OPERATOR' }] },
  ])
  expect(totp).toHaveBeenCalledWith(['a', 'b'])
  const { users } = await res.json()
  expect(users.map((u: { totpEnrolled: boolean }) => u.totpEnrolled)).toEqual([true, false])
  expect(users[0].mfaRequired).toBe(true)
})

it('mfa=off 는 mfaRequired false 이고 운영자 제외', async () => {
  await call('?mfa=off')
  expect(findMany.mock.calls[0][0].where).toMatchObject({ mfaRequired: false, platformRole: null })
})

it('mfa=required 와 q 검색의 OR 가 서로 덮어쓰지 않는다', async () => {
  await call('?mfa=required&q=kim')
  const where = findMany.mock.calls[0][0].where
  expect(where.OR).toHaveLength(2)
  expect(where.AND).toHaveLength(1)
})

it('helper 가 null 이면 totpEnrolled 는 모두 null 이고 200', async () => {
  totp.mockResolvedValue(null)
  const res = await call('?mfa=required')
  expect(res.status).toBe(200)
  const { users } = await res.json()
  expect(users.every((u: { totpEnrolled: null }) => u.totpEnrolled === null)).toBe(true)
})
