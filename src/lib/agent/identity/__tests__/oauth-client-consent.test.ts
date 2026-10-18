/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: jest.fn() } }))
import { prisma } from '@/lib/prisma'
import { hasActiveOAuthConsent } from '../oauth-client-consent'

const q = prisma.$queryRaw as unknown as jest.Mock

it('유효한 동의 행이 있으면 true, 없으면 false', async () => {
  q.mockResolvedValueOnce([{ ok: 1 }])
  expect(await hasActiveOAuthConsent('u-1', 'cl-1')).toBe(true)
  q.mockResolvedValueOnce([])
  expect(await hasActiveOAuthConsent('u-1', 'cl-1')).toBe(false)
})

it('쿼리는 본인·해당 클라이언트·미철회·미삭제 조건으로 묶인다', async () => {
  q.mockResolvedValueOnce([])
  await hasActiveOAuthConsent('u-1', 'cl-1')
  const [strings, ...values] = q.mock.calls.at(-1)!
  const sql = (strings as string[]).join('?')
  expect(sql).toContain('auth.oauth_consents')
  expect(sql).toContain('revoked_at is null')
  expect(sql).toContain('deleted_at is null')
  expect(values).toEqual(['u-1', 'cl-1'])
})
