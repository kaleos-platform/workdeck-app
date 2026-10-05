/** @jest-environment node */
import { NextRequest } from 'next/server'
import { PUT } from '../route'
import { prisma } from '@/lib/prisma'
import { canWorkspaceCollect } from '@/lib/billing/entitlement'

jest.mock('@/lib/api-helpers', () => ({
  resolveWorkspace: jest.fn(),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/hooks/use-user', () => ({ getUser: async () => ({ id: 'u', user_metadata: {} }) }))
jest.mock('@/lib/workspace', () => ({
  ensureWorkspaceForUser: async () => ({ workspace: { id: 'ws' } }),
}))
jest.mock('@/lib/collection/secret-crypto', () => ({
  encryptSecret: () => ({ encrypted: 'e', iv: 'i' }),
}))
jest.mock('@/lib/billing/entitlement', () => ({ canWorkspaceCollect: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    coupangCredential: { upsert: jest.fn() },
    collectionRun: { findFirst: jest.fn(), create: jest.fn() },
  },
}))

const run = prisma.collectionRun as unknown as { findFirst: jest.Mock; create: jest.Mock }
const save = async () => {
  const res = await PUT(
    new NextRequest('http://localhost/api/collection/credentials', {
      method: 'PUT',
      body: JSON.stringify({ loginId: 'id', password: 'pw' }),
    })
  )
  return (await res.json()) as { retriggered: boolean }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.coupangCredential.upsert as jest.Mock).mockResolvedValue({ id: 'c' })
  ;(canWorkspaceCollect as jest.Mock).mockResolvedValue(true)
})

describe('PUT /api/collection/credentials — 비번 오류 후 재수집', () => {
  it('직전 수집이 비번 불일치로 실패했으면 PENDING 수집을 만든다', async () => {
    run.findFirst.mockResolvedValue({
      status: 'FAILED',
      error: '로그인 실패 — 아이디/비밀번호 불일치 (비밀번호 변경·만료 의심)',
    })
    expect((await save()).retriggered).toBe(true)
    expect(run.create).toHaveBeenCalledWith({
      data: { workspaceId: 'ws', triggeredBy: 'manual', status: 'PENDING' },
    })
  })

  it('다른 사유 실패·성공 이력이면 만들지 않는다', async () => {
    run.findFirst.mockResolvedValue({ status: 'FAILED', error: '로그인 실패 — Akamai 봇 차단' })
    expect((await save()).retriggered).toBe(false)
    run.findFirst.mockResolvedValue({ status: 'COMPLETED', error: null })
    expect((await save()).retriggered).toBe(false)
    expect(run.create).not.toHaveBeenCalled()
  })

  it('구독 만료면 만들지 않는다', async () => {
    run.findFirst.mockResolvedValue({ status: 'FAILED', error: '아이디/비밀번호 불일치' })
    ;(canWorkspaceCollect as jest.Mock).mockResolvedValue(false)
    expect((await save()).retriggered).toBe(false)
    expect(run.create).not.toHaveBeenCalled()
  })
})
