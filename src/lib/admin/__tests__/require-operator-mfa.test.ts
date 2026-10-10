/** @jest-environment node */
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { requireAal2 } from '@/lib/auth/mfa'
import { requireOperator } from '../auth'

jest.mock('server-only', () => ({}))
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: jest.fn() } } }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))

const now = Math.floor(Date.now() / 1000)
function aal(level: string, totpAgeSec: number | null) {
  ;(createClient as jest.Mock).mockResolvedValue({
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: jest.fn().mockResolvedValue({
          data: {
            currentLevel: level,
            currentAuthenticationMethods:
              totpAgeSec === null ? [] : [{ method: 'totp', timestamp: now - totpAgeSec }],
          },
          error: null,
        }),
      },
    },
  })
}

beforeEach(() => {
  delete process.env.ADMIN_REQUIRE_MFA
  ;(getUser as jest.Mock).mockResolvedValue({ id: 'op' })
  ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
    platformRole: 'OPERATOR',
    email: 'op@x',
  })
})

test('기본값으로 MFA 강제 — aal1 이면 MFA_REQUIRED', async () => {
  aal('aal1', null)
  const r = await requireOperator()
  expect(r.ok).toBe(false)
  expect(!r.ok && r.reason).toBe('MFA_REQUIRED')
})

test('aal2 + 최근 TOTP → 통과', async () => {
  aal('aal2', 60)
  expect((await requireOperator()).ok).toBe(true)
})

test('31일 지난 TOTP → 다시 요구', async () => {
  aal('aal2', 31 * 24 * 3600)
  expect((await requireOperator()).ok).toBe(false)
})

test("ADMIN_REQUIRE_MFA='false' 는 비상 해제 스위치", async () => {
  process.env.ADMIN_REQUIRE_MFA = 'false'
  aal('aal1', null)
  expect((await requireOperator()).ok).toBe(true)
})

test('비상 해제 스위치는 자격증명 게이트(requireAal2)에도 같이 적용된다', async () => {
  aal('aal1', null)
  expect((await requireAal2())?.status).toBe(403)
  process.env.ADMIN_REQUIRE_MFA = 'false'
  await expect(requireAal2()).resolves.toBeNull()
})
