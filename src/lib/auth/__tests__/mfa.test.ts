/** @jest-environment node */
jest.mock('server-only', () => ({}))
const getAal = jest.fn()
const getClaims = jest.fn()
const findUnique = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getClaims, mfa: { getAuthenticatorAssuranceLevel: getAal } },
  }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}))

import { requireAal2, requireFreshAal2 } from '../mfa'

const AAL1 = { data: { currentLevel: 'aal1', currentAuthenticationMethods: [] }, error: null }
const AAL2 = {
  data: {
    currentLevel: 'aal2',
    currentAuthenticationMethods: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }],
  },
  error: null,
}

beforeEach(() => {
  jest.resetAllMocks()
  getClaims.mockResolvedValue({ data: { claims: { sub: 'u1' } }, error: null })
  findUnique.mockResolvedValue({ mfaRequired: false, platformRole: 'USER' })
})

afterEach(() => {
  delete process.env.ADMIN_REQUIRE_MFA
})

test('비상 해제(ADMIN_REQUIRE_MFA=false)면 requireAal2는 열리지만 requireFreshAal2는 403', async () => {
  process.env.ADMIN_REQUIRE_MFA = 'false'
  getAal.mockResolvedValue(AAL1)
  expect(await requireAal2()).toBeNull()
  const res = await requireFreshAal2()
  expect(res?.status).toBe(403)
  await expect(res!.json()).resolves.toMatchObject({ code: 'MFA_REQUIRED' })
})

test('requireFreshAal2는 실제 aal2면 통과', async () => {
  process.env.ADMIN_REQUIRE_MFA = 'false'
  getAal.mockResolvedValue(AAL2)
  expect(await requireFreshAal2()).toBeNull()
})

test('mfaRequired=false 면 aal1 이어도 requireAal2 통과', async () => {
  getAal.mockResolvedValue(AAL1)
  expect(await requireAal2()).toBeNull()
})

test('mfaRequired=true 면 aal1 은 403 MFA_REQUIRED', async () => {
  findUnique.mockResolvedValue({ mfaRequired: true, platformRole: 'USER' })
  getAal.mockResolvedValue(AAL1)
  const res = await requireAal2()
  expect(res?.status).toBe(403)
  await expect(res!.json()).resolves.toMatchObject({ code: 'MFA_REQUIRED' })
})

test('mfaRequired=true 이고 fresh aal2 면 통과', async () => {
  findUnique.mockResolvedValue({ mfaRequired: true, platformRole: 'USER' })
  getAal.mockResolvedValue(AAL2)
  expect(await requireAal2()).toBeNull()
})

test('claims 실패면 aal1 은 403 (닫힘)', async () => {
  getClaims.mockResolvedValue({ data: null, error: new Error('x') })
  getAal.mockResolvedValue(AAL1)
  expect((await requireAal2())?.status).toBe(403)
  expect(findUnique).not.toHaveBeenCalled()
})

test('User 행 없으면 통과', async () => {
  findUnique.mockResolvedValue(null)
  getAal.mockResolvedValue(AAL1)
  expect(await requireAal2()).toBeNull()
})

test('운영자는 mfaRequired=false 여도 aal1 이면 403', async () => {
  findUnique.mockResolvedValue({ mfaRequired: false, platformRole: 'OPERATOR' })
  getAal.mockResolvedValue(AAL1)
  expect((await requireAal2())?.status).toBe(403)
})

test('ignoreUserFlag 면 mfaRequired=false 여도 aal1 이면 403, 비상 해제면 통과', async () => {
  getAal.mockResolvedValue(AAL1)
  expect((await requireAal2({ ignoreUserFlag: true }))?.status).toBe(403)
  process.env.ADMIN_REQUIRE_MFA = 'false'
  expect(await requireAal2({ ignoreUserFlag: true })).toBeNull()
})

test('requireFreshAal2 는 mfaRequired=false 여도 aal1 이면 403', async () => {
  getAal.mockResolvedValue(AAL1)
  expect((await requireFreshAal2())?.status).toBe(403)
})
