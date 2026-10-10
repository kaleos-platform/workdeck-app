/** @jest-environment node */
import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveCollectionAuth } from '@/lib/collection/resolve-workspace'
import { encryptField } from '@/lib/crypto/field-crypto'
import { encryptSecret } from '@/lib/collection/secret-crypto'
import { requireAal2 } from '@/lib/auth/mfa'
import { DELETE, PUT } from '../route'

jest.mock('@/lib/api-helpers', () => {
  const { NextResponse } = jest.requireActual('next/server')
  // 실제 역할 위계(OWNER > ADMIN > MEMBER)를 반영한 assertRole
  const rank = { OWNER: 3, ADMIN: 2, MEMBER: 1 } as const
  return {
    errorResponse: (message: string, status: number) => NextResponse.json({ message }, { status }),
    assertRole: (r: keyof typeof rank, req: keyof typeof rank) =>
      rank[r] < rank[req]
        ? NextResponse.json({ message: '권한이 없습니다' }, { status: 403 })
        : null,
  }
})
jest.mock('@/lib/collection/secret-crypto', () => ({
  encryptSecret: jest.fn(jest.requireActual('@/lib/collection/secret-crypto').encryptSecret),
}))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn().mockResolvedValue(null) }))
jest.mock('@/lib/collection/resolve-workspace', () => ({ resolveCollectionAuth: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    coupangApiCredential: { findUnique: jest.fn(), upsert: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(),
  },
}))

const auth = resolveCollectionAuth as jest.Mock
const cred = prisma.coupangApiCredential as unknown as { findUnique: jest.Mock; upsert: jest.Mock }
const base = { vendorId: 'A00000000', accessKey: 'AK123456' }
const put = (body: unknown) =>
  PUT(
    new NextRequest('http://t/api/collection/api-credentials', {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  jest.clearAllMocks()
  for (const k of ['ENCRYPTION_KEY', 'ENCRYPTION_WRITE_VERSION', 'VERCEL_ENV'])
    delete process.env[k]
  process.env.ENCRYPTION_KEY_V1 = 'a'.repeat(64)
  cred.findUnique.mockResolvedValue({ id: 'c' })
  cred.upsert.mockResolvedValue({
    vendorId: base.vendorId,
    accessKey: base.accessKey,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})

test('세션이 encryptionIv 를 보내면 400, 저장 없음', async () => {
  auth.mockResolvedValue({ kind: 'session', role: 'ADMIN', workspaceId: 'ws' })
  expect((await put({ ...base, secretKey: 'plain', encryptionIv: 'none' })).status).toBe(400)
  expect(cred.upsert).not.toHaveBeenCalled()
})

test('세션 secretKey 는 서버가 collection-credential 용도로 암호화해 저장한다', async () => {
  auth.mockResolvedValue({ kind: 'session', role: 'ADMIN', workspaceId: 'ws' })
  await put({ ...base, secretKey: 'sk-plain' })
  const update = cred.upsert.mock.calls[0][0].update
  expect(update.encryptionIv).toBe('v1')
  expect(update.secretKey).not.toContain('sk-plain')
})

test('워커 재전달도 복호화되지 않는 값(iv=none, 임의 IV)은 400', async () => {
  auth.mockResolvedValue({ kind: 'worker', workspaceId: 'ws' })
  expect((await put({ ...base, secretKey: 'plain', encryptionIv: 'none' })).status).toBe(400)
  expect((await put({ ...base, secretKey: '00ff', encryptionIv: '0'.repeat(32) })).status).toBe(400)
  expect(cred.upsert).not.toHaveBeenCalled()
})

test('워커 재전달은 v1 만 — 정상 v0 암호문에 다른 IV 를 붙여도(복호화는 성공하는 조합) 400', async () => {
  auth.mockResolvedValue({ kind: 'worker', workspaceId: 'ws' })
  const K0 = 'c'.repeat(64)
  process.env.ENCRYPTION_KEY = K0
  const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(K0, 'hex'), crypto.randomBytes(16))
  const v0 = c.update('secret-key-value', 'utf8', 'hex') + c.final('hex')
  expect((await put({ ...base, secretKey: v0, encryptionIv: 'f'.repeat(32) })).status).toBe(400)
  expect(cred.upsert).not.toHaveBeenCalled()
})

test('워커 재전달은 복호화되는 암호문만 그대로 저장한다', async () => {
  auth.mockResolvedValue({ kind: 'worker', workspaceId: 'ws' })
  const sealed = encryptField('collection-credential', 'sk')
  await put({ ...base, secretKey: sealed.encrypted, encryptionIv: sealed.iv })
  expect(cred.upsert.mock.calls[0][0].update).toMatchObject({
    secretKey: sealed.encrypted,
    encryptionIv: 'v1',
  })
})

test('암호화 실패 500 응답 본문에 오류 원문이 들어가지 않는다', async () => {
  auth.mockResolvedValue({ kind: 'session', role: 'ADMIN', workspaceId: 'ws' })
  ;(encryptSecret as jest.Mock).mockImplementationOnce(() => {
    throw new Error('ENCRYPTION_KEY SYNTHETIC-SECRET-123')
  })
  const res = await put({ ...base, secretKey: 'sk-plain' })
  expect(res.status).toBe(500)
  expect(await res.text()).not.toContain('SYNTHETIC-SECRET-123')
})

test('v0 쓰기 기간(4a)에는 워커 v1 재전달도 400 — v1 행을 만들지 않는다', async () => {
  auth.mockResolvedValue({ kind: 'worker', workspaceId: 'ws' })
  const sealed = encryptField('collection-credential', 'sk')
  process.env.ENCRYPTION_WRITE_VERSION = 'v0'
  process.env.ENCRYPTION_KEY = 'c'.repeat(64)
  expect(
    (await put({ ...base, secretKey: sealed.encrypted, encryptionIv: sealed.iv })).status
  ).toBe(400)
  expect(cred.upsert).not.toHaveBeenCalled()
})

test('세션 PUT·DELETE 는 aal2 미충족이면 403, 저장·삭제 없음', async () => {
  auth.mockResolvedValue({ kind: 'session', role: 'ADMIN', workspaceId: 'ws' })
  ;(requireAal2 as jest.Mock).mockResolvedValue(
    NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 })
  )
  expect((await put({ ...base, secretKey: 'sk' })).status).toBe(403)
  const del = await DELETE(
    new NextRequest('http://t/api/collection/api-credentials', { method: 'DELETE' })
  )
  expect(del.status).toBe(403)
  expect(cred.upsert).not.toHaveBeenCalled()
  expect(prisma.$transaction).not.toHaveBeenCalled()
  ;(requireAal2 as jest.Mock).mockResolvedValue(null)
})

test('워커 PUT 은 MFA 를 요구하지 않는다', async () => {
  auth.mockResolvedValue({ kind: 'worker', workspaceId: 'ws' })
  ;(requireAal2 as jest.Mock).mockClear()
  await put({
    ...base,
    secretKey: encryptField('collection-credential', 'sk').encrypted,
    encryptionIv: 'v1',
  })
  expect(requireAal2).not.toHaveBeenCalled()
})

test('세션 MEMBER 의 PUT·DELETE 는 403 권한 거부, MFA 검사·DB 접근 없음', async () => {
  auth.mockResolvedValue({ kind: 'session', role: 'MEMBER', workspaceId: 'ws' })
  ;(requireAal2 as jest.Mock).mockClear()
  const res = await put({ ...base, secretKey: 'sk' })
  expect(res.status).toBe(403)
  expect((await res.json()).code).toBeUndefined()
  const del = await DELETE(
    new NextRequest('http://t/api/collection/api-credentials', { method: 'DELETE' })
  )
  expect(del.status).toBe(403)
  expect(requireAal2).not.toHaveBeenCalled()
  expect(cred.findUnique).not.toHaveBeenCalled()
  expect(cred.upsert).not.toHaveBeenCalled()
  expect(prisma.$transaction).not.toHaveBeenCalled()
})
