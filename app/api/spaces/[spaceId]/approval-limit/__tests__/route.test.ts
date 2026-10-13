/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({ prisma: { space: { update: jest.fn() } } }))
jest.mock('@/lib/agent/identity/space-admin', () => ({ requireSpaceOwner: jest.fn() }))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSpaceOwner } from '@/lib/agent/identity/space-admin'
import { requireAal2 } from '@/lib/auth/mfa'
import { PUT } from '../route'

const call = (body: unknown) =>
  PUT(
    new NextRequest('http://t/api/spaces/sp1/approval-limit', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ spaceId: 'sp1' }) }
  )

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireAal2 as jest.Mock).mockResolvedValue(null)
})

it('OWNER가 아니면 403이고 DB를 쓰지 않는다', async () => {
  ;(requireSpaceOwner as jest.Mock).mockResolvedValue({
    error: NextResponse.json({}, { status: 403 }),
  })
  expect((await call({ approvalLimitKrw: 100000 })).status).toBe(403)
  expect(prisma.space.update).not.toHaveBeenCalled()
})

it('OWNER라도 MFA(aal2) 미충족이면 403 MFA_REQUIRED, DB를 쓰지 않는다', async () => {
  ;(requireSpaceOwner as jest.Mock).mockResolvedValue({ userId: 'u1' })
  ;(requireAal2 as jest.Mock).mockResolvedValue(
    NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 })
  )
  const res = await call({ approvalLimitKrw: 100000 })
  expect(res.status).toBe(403)
  await expect(res.json()).resolves.toMatchObject({ code: 'MFA_REQUIRED' })
  expect(prisma.space.update).not.toHaveBeenCalled()
})

it('OWNER가 아니면 MFA 검사 전에 거부한다', async () => {
  ;(requireSpaceOwner as jest.Mock).mockResolvedValue({
    error: NextResponse.json({}, { status: 403 }),
  })
  await call({ approvalLimitKrw: 1 })
  expect(requireAal2).not.toHaveBeenCalled()
})

it('OWNER는 한도를 저장한다(null 허용)', async () => {
  ;(requireSpaceOwner as jest.Mock).mockResolvedValue({ userId: 'u1' })
  ;(prisma.space.update as jest.Mock).mockResolvedValue({ id: 'sp1', approvalLimitKrw: 100000 })
  expect((await call({ approvalLimitKrw: 100000 })).status).toBe(200)
  expect(prisma.space.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'sp1' }, data: { approvalLimitKrw: 100000 } })
  )
  await call({ approvalLimitKrw: null })
  expect(prisma.space.update).toHaveBeenLastCalledWith(
    expect.objectContaining({ data: { approvalLimitKrw: null } })
  )
})

it('음수·소수·문자열은 400', async () => {
  ;(requireSpaceOwner as jest.Mock).mockResolvedValue({ userId: 'u1' })
  for (const v of [-1, 1.5, '100']) expect((await call({ approvalLimitKrw: v })).status).toBe(400)
  expect(prisma.space.update).not.toHaveBeenCalled()
})
