/** @jest-environment node */
import { NextRequest } from 'next/server'
import { PUT } from '../route'
import { prisma } from '@/lib/prisma'
import { canWorkspaceCollect } from '@/lib/billing/entitlement'
import { resolveSpaceContext, resolveWorkspace } from '@/lib/api-helpers'
import { encryptSecret } from '@/lib/collection/secret-crypto'
import { encryptField } from '@/lib/crypto/field-crypto'
import { requireAal2 } from '@/lib/auth/mfa'

jest.mock('@/lib/api-helpers', () => {
  // 실제 역할 위계(OWNER > ADMIN > MEMBER)를 반영한 assertRole
  const rank = { OWNER: 3, ADMIN: 2, MEMBER: 1 } as const
  return {
    resolveWorkspace: jest.fn(),
    resolveSpaceContext: jest.fn(),
    errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
    assertRole: (r: keyof typeof rank, req: keyof typeof rank) =>
      rank[r] < rank[req] ? Response.json({ message: '권한이 없습니다' }, { status: 403 }) : null,
  }
})
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn().mockResolvedValue(null) }))
jest.mock('@/hooks/use-user', () => ({ getUser: async () => ({ id: 'u', user_metadata: {} }) }))
jest.mock('@/lib/workspace', () => ({
  ensureWorkspaceForUser: async () => ({ workspace: { id: 'ws' } }),
}))
jest.mock('@/lib/collection/secret-crypto', () => ({
  encryptSecret: jest.fn(() => ({ encrypted: 'e', iv: 'i' })),
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
  if (!res) throw new Error('응답이 없습니다')
  return (await res.json()) as { retriggered: boolean }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.coupangCredential.upsert as jest.Mock).mockResolvedValue({ id: 'c' })
  ;(canWorkspaceCollect as jest.Mock).mockResolvedValue(true)
  ;(resolveSpaceContext as jest.Mock).mockResolvedValue({ role: 'ADMIN' })
  ;(requireAal2 as jest.Mock).mockResolvedValue(null)
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

describe('PUT /api/collection/credentials — 암호문 직접 입력 차단', () => {
  const put = (body: unknown, headers: Record<string, string> = {}) =>
    PUT(
      new NextRequest('http://localhost/api/collection/credentials', {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
    )

  it('세션 요청이 encryptionIv 를 보내면 400, 저장 없음', async () => {
    const res = await put({ loginId: 'id', loginPassword: 'plain', encryptionIv: 'none' })
    expect(res?.status).toBe(400)
    expect(prisma.coupangCredential.upsert).not.toHaveBeenCalled()
  })

  it('워커 재전달이라도 복호화되지 않는 값(iv=none)은 400, 저장 없음', async () => {
    process.env.WORKER_API_KEY = 'wk'
    ;(resolveWorkspace as jest.Mock).mockResolvedValue({ workspace: { id: 'ws' } })
    const res = await put(
      { loginId: 'id', loginPassword: 'plain', encryptionIv: 'none' },
      { 'x-worker-api-key': 'wk' }
    )
    expect(res?.status).toBe(400)
    expect(prisma.coupangCredential.upsert).not.toHaveBeenCalled()
  })
  it('암호화 실패 500 응답 본문에 오류 원문이 들어가지 않는다', async () => {
    ;(encryptSecret as jest.Mock).mockImplementationOnce(() => {
      throw new Error('ENCRYPTION_KEY SYNTHETIC-SECRET-123')
    })
    const res = await put({ loginId: 'id', password: 'pw' })
    expect(res?.status).toBe(500)
    expect(await res?.text()).not.toContain('SYNTHETIC-SECRET-123')
  })

  it('v0 쓰기 기간(4a)에는 워커 v1 재전달도 400, 저장 없음', async () => {
    process.env.WORKER_API_KEY = 'wk'
    process.env.ENCRYPTION_KEY_V1 = 'a'.repeat(64)
    delete process.env.VERCEL_ENV
    delete process.env.ENCRYPTION_WRITE_VERSION
    const sealed = encryptField('collection-credential', 'pw')
    process.env.ENCRYPTION_WRITE_VERSION = 'v0'
    process.env.ENCRYPTION_KEY = 'c'.repeat(64)
    ;(resolveWorkspace as jest.Mock).mockResolvedValue({ workspace: { id: 'ws' } })
    const res = await put(
      { loginId: 'id', loginPassword: sealed.encrypted, encryptionIv: sealed.iv },
      { 'x-worker-api-key': 'wk' }
    )
    expect(res?.status).toBe(400)
    expect(prisma.coupangCredential.upsert).not.toHaveBeenCalled()
    delete process.env.ENCRYPTION_WRITE_VERSION
  })
})

it('세션 PUT 은 aal2 미충족이면 403, 저장 없음', async () => {
  ;(requireAal2 as jest.Mock).mockResolvedValueOnce(
    Response.json({ code: 'MFA_REQUIRED' }, { status: 403 })
  )
  const res = await PUT(
    new NextRequest('http://localhost/api/collection/credentials', {
      method: 'PUT',
      body: JSON.stringify({ loginId: 'id', password: 'pw' }),
    })
  )
  expect(res?.status).toBe(403)
  expect(prisma.coupangCredential.upsert).not.toHaveBeenCalled()
})

describe('PUT /api/collection/credentials — 역할·MFA 게이트', () => {
  const sessionPut = () =>
    PUT(
      new NextRequest('http://localhost/api/collection/credentials', {
        method: 'PUT',
        body: JSON.stringify({ loginId: 'id', password: 'pw' }),
      })
    )

  it('MEMBER 는 aal1·aal2 모두 403 권한 거부, MFA 검사·저장 없음', async () => {
    ;(resolveSpaceContext as jest.Mock).mockResolvedValue({ role: 'MEMBER' })
    for (const aal of [Response.json({ code: 'MFA_REQUIRED' }, { status: 403 }), null]) {
      ;(requireAal2 as jest.Mock).mockResolvedValue(aal)
      const res = await sessionPut()
      expect(res?.status).toBe(403)
      expect((await res?.json()).code).toBeUndefined()
    }
    expect(requireAal2).not.toHaveBeenCalled()
    expect(prisma.coupangCredential.upsert).not.toHaveBeenCalled()
  })

  it('Space 멤버십이 없는 첫 사용자는 ensure 가 OWNER 로 만들므로 역할 거부 없이 MFA 로 간다', async () => {
    ;(resolveSpaceContext as jest.Mock).mockResolvedValue({
      error: Response.json({ message: '공간이 없습니다' }, { status: 404 }),
    })
    ;(requireAal2 as jest.Mock).mockResolvedValue(
      Response.json({ code: 'MFA_REQUIRED' }, { status: 403 })
    )
    const res = await sessionPut()
    expect((await res?.json()).code).toBe('MFA_REQUIRED')
    expect(prisma.coupangCredential.upsert).not.toHaveBeenCalled()
  })

  it('워커 PUT(x-worker-api-key)은 MFA·역할 검사를 하지 않는다', async () => {
    process.env.WORKER_API_KEY = 'wk'
    process.env.ENCRYPTION_KEY_V1 = 'a'.repeat(64)
    delete process.env.VERCEL_ENV
    delete process.env.ENCRYPTION_WRITE_VERSION
    ;(resolveWorkspace as jest.Mock).mockResolvedValue({ workspace: { id: 'ws' } })
    const sealed = encryptField('collection-credential', 'pw')
    const res = await PUT(
      new NextRequest('http://localhost/api/collection/credentials', {
        method: 'PUT',
        headers: { 'x-worker-api-key': 'wk' },
        body: JSON.stringify({
          loginId: 'id',
          loginPassword: sealed.encrypted,
          encryptionIv: sealed.iv,
        }),
      })
    )
    expect(res?.status).toBe(200)
    expect(requireAal2).not.toHaveBeenCalled()
    expect(resolveSpaceContext).not.toHaveBeenCalled()
  })
})
