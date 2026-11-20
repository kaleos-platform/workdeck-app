/** @jest-environment node */
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/api-helpers', () => ({
  ...jest.requireActual('@/lib/api-helpers'),
  resolveSpaceContext: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: jest.fn() } }))
jest.mock('@/lib/spaces/create-owned-space', () => ({
  ...jest.requireActual('@/lib/spaces/owned-space-limit'),
  createOwnedSpaceInTx: jest.fn(),
}))

import { NextRequest } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { createOwnedSpaceInTx } from '@/lib/spaces/create-owned-space'
import { POST } from '../route'

const call = (body: unknown) =>
  POST(new NextRequest('http://x/api/spaces', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  jest.resetAllMocks()
  jest.mocked(getUser).mockResolvedValue({ id: 'u-1', email: 'a@b.c' } as never)
  jest
    .mocked(prisma.$transaction)
    .mockImplementation(async (fn) => (fn as unknown as (t: unknown) => Promise<unknown>)(prisma))
  jest.spyOn(console, 'info').mockImplementation(() => {})
})

it('로그인이 없으면 401', async () => {
  jest.mocked(getUser).mockResolvedValue(null)
  expect((await call({ name: 'a' })).status).toBe(401)
  expect(prisma.$transaction).not.toHaveBeenCalled()
})

it.each([{ name: '   ' }, { name: 'x'.repeat(61) }, {}, null])(
  '잘못된 본문 %j 은 422',
  async (b) => {
    expect((await call(b)).status).toBe(422)
  }
)

it('정상 생성은 201 {space} — trim·NFC, maxOwned 5, 업무는 켜지 않고 PII 없는 로그', async () => {
  jest
    .mocked(createOwnedSpaceInTx)
    .mockResolvedValue({ space: { id: 'sp-new', name: '대성산업' }, blockedJobs: 2 })
  const res = await call({ name: '  대성산업  ' })
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ space: { id: 'sp-new', name: '대성산업' } })
  expect(createOwnedSpaceInTx).toHaveBeenCalledWith(prisma, {
    userId: 'u-1',
    name: '대성산업',
    maxOwned: 5,
  })
  expect(console.info).toHaveBeenCalledWith('space.create.user', {
    userId: 'u-1',
    spaceId: 'sp-new',
    blockedJobs: 2,
  })
})

it('같은 이름은 409 + spaceId', async () => {
  jest.mocked(createOwnedSpaceInTx).mockResolvedValue({ duplicateSpaceId: 'sp-old' })
  const res = await call({ name: 'a' })
  expect(res.status).toBe(409)
  expect((await res.json()).spaceId).toBe('sp-old')
})

it('상한이면 409 SPACE_LIMIT', async () => {
  jest.mocked(createOwnedSpaceInTx).mockResolvedValue({ limitReached: true })
  const res = await call({ name: 'a' })
  expect(res.status).toBe(409)
  expect((await res.json()).code).toBe('SPACE_LIMIT')
})

it('예외는 500', async () => {
  jest.mocked(createOwnedSpaceInTx).mockRejectedValue(new Error('db'))
  expect((await call({ name: 'a' })).status).toBe(500)
})
