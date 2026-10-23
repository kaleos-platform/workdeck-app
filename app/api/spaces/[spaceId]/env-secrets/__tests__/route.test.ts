/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'

jest.mock('@/lib/prisma', () => ({
  prisma: { spaceAgentSetting: { findUnique: jest.fn(), upsert: jest.fn() } },
}))
jest.mock('@/lib/agent/identity/space-admin', () => ({
  requireSpaceAdmin: jest.fn(),
}))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn(), requireFreshAal2: jest.fn() }))
jest.mock('@/lib/agent/audit', () => ({
  AUDIT_UNAVAILABLE: '감사 기록을 남길 수 없어 실행하지 않았습니다',
  startToolAudit: jest.fn(async () => 'audit1'),
  finishToolAudit: jest.fn(async () => undefined),
}))

import { prisma } from '@/lib/prisma'
import { requireAal2, requireFreshAal2 } from '@/lib/auth/mfa'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { startToolAudit, finishToolAudit } from '@/lib/agent/audit'
import { GET, PATCH } from '../route'

const ctx = { params: Promise.resolve({ spaceId: 'sp1' }) }
const patch = (body: unknown = { envSecretsEnabled: true }) =>
  PATCH(new NextRequest('http://t/x', { method: 'PATCH', body: JSON.stringify(body) }), ctx)
const asRole = (role: string) =>
  (requireSpaceAdmin as jest.Mock).mockResolvedValue({ userId: 'u1', role })
const upsert = prisma.spaceAgentSetting.upsert as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  asRole('OWNER')
  ;(requireFreshAal2 as jest.Mock).mockResolvedValue(null)
  ;(prisma.spaceAgentSetting.findUnique as jest.Mock).mockResolvedValue(null)
  upsert.mockResolvedValue({ envSecretsEnabled: true })
})

it('행이 없으면 GET은 false', async () => {
  asRole('ADMIN')
  const res = await GET(new NextRequest('http://t/x'), ctx)
  expect(await res.json()).toEqual({ envSecretsEnabled: false, canManage: false })
})

it('OWNER의 GET은 canManage true', async () => {
  ;(prisma.spaceAgentSetting.findUnique as jest.Mock).mockResolvedValue({ envSecretsEnabled: true })
  expect(await (await GET(new NextRequest('http://t/x'), ctx)).json()).toEqual({
    envSecretsEnabled: true,
    canManage: true,
  })
})

it('ADMIN의 PATCH는 403', async () => {
  asRole('ADMIN')
  const res = await patch()
  expect(res.status).toBe(403)
  expect((await res.json()).message).toBe('OWNER만 변경할 수 있습니다')
  expect(upsert).not.toHaveBeenCalled()
})

it('OWNER라도 fresh aal2가 아니면 MFA 요구, 저장 안 함 (ADMIN_REQUIRE_MFA=false여도 requireFreshAal2 사용)', async () => {
  process.env.ADMIN_REQUIRE_MFA = 'false'
  ;(requireFreshAal2 as jest.Mock).mockResolvedValue(
    NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 })
  )
  const res = await patch()
  delete process.env.ADMIN_REQUIRE_MFA
  expect(res.status).toBe(403)
  expect(requireFreshAal2).toHaveBeenCalled()
  expect(requireAal2).not.toHaveBeenCalled()
  expect(upsert).not.toHaveBeenCalled()
  expect(startToolAudit).not.toHaveBeenCalled()
})

it('감사 시작 실패면 503, 저장 안 함', async () => {
  ;(startToolAudit as jest.Mock).mockRejectedValueOnce(new Error('db'))
  expect((await patch()).status).toBe(503)
  expect(upsert).not.toHaveBeenCalled()
})

it('잘못된 본문은 400', async () => {
  expect((await patch({ envSecretsEnabled: 'yes' })).status).toBe(400)
  expect(upsert).not.toHaveBeenCalled()
})

it('OWNER+fresh aal2면 upsert 후 true', async () => {
  const res = await patch()
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ envSecretsEnabled: true, canManage: true })
  expect(upsert).toHaveBeenCalledWith({
    where: { spaceId: 'sp1' },
    create: { spaceId: 'sp1', envSecretsEnabled: true },
    update: { envSecretsEnabled: true },
  })
  expect(startToolAudit).toHaveBeenCalledWith(
    expect.objectContaining({
      tool: 'space.env_secrets',
      args: { envSecretsEnabled: true },
      actor: { type: 'user', id: 'u1' },
    })
  )
  expect(finishToolAudit).toHaveBeenCalledWith('audit1', expect.objectContaining({ outcome: 'ok' }))
})
