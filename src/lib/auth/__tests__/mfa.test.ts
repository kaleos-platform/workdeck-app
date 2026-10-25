/** @jest-environment node */
jest.mock('server-only', () => ({}))
const getAal = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { mfa: { getAuthenticatorAssuranceLevel: getAal } } }),
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
