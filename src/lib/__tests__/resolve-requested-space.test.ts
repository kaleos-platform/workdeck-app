/** @jest-environment node */
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/spaces/current-space', () => ({ resolveCurrentMembership: jest.fn() }))
import { getUser } from '@/hooks/use-user'
import { resolveCurrentMembership } from '@/lib/spaces/current-space'
import { resolveRequestedSpaceContext, resolveSpaceContext } from '@/lib/api-helpers'

const current = resolveCurrentMembership as jest.Mock
beforeEach(() => {
  jest.resetAllMocks()
  ;(getUser as jest.Mock).mockResolvedValue({ id: 'u-1' })
})

it('선택 없음 → 현재 Space(쿠키·기본값), SPACE_REQUIRED 없음', async () => {
  current.mockResolvedValue({ role: 'ADMIN', space: { id: 'sp-b', name: 'Space B' } })
  const r = await resolveRequestedSpaceContext(null)
  expect(r).toMatchObject({ space: { id: 'sp-b' }, role: 'ADMIN' })
  expect(current).toHaveBeenCalledWith('u-1', null)
})

it('명시 Space 비구성원 → 403', async () => {
  current.mockResolvedValue({ forbidden: true })
  const r = await resolveRequestedSpaceContext('sp-x')
  if (!('error' in r)) throw new Error('error 기대')
  expect(r.error.status).toBe(403)
})

it('멤버십 없음 → 404', async () => {
  current.mockResolvedValue(null)
  const r = await resolveRequestedSpaceContext(null)
  if (!('error' in r)) throw new Error('error 기대')
  expect(r.error.status).toBe(404)
})

it('resolveSpaceContext 도 현재 Space', async () => {
  current.mockResolvedValue({ role: 'OWNER', space: { id: 'sp-a', name: 'Space A' } })
  expect(await resolveSpaceContext()).toMatchObject({ space: { id: 'sp-a' }, role: 'OWNER' })
  expect(current).toHaveBeenCalledWith('u-1')
})
