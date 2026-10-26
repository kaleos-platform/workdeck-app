/** @jest-environment node */
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/spaces/current-space', () => ({ resolveCurrentMembership: jest.fn() }))
const headerGet = jest.fn()
jest.mock('next/headers', () => ({ headers: async () => ({ get: headerGet }) }))
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

describe('x-wd-space 헤더 대조(다른 탭 Space 전환 방지)', () => {
  beforeEach(() => {
    current.mockResolvedValue({ role: 'OWNER', space: { id: 'sp-y', name: 'Space Y' } })
  })

  it('불일치 → 409', async () => {
    headerGet.mockReturnValue('sp-x')
    for (const r of [await resolveSpaceContext(), await resolveRequestedSpaceContext(null)]) {
      if (!('error' in r)) throw new Error('error 기대')
      expect(r.error.status).toBe(409)
    }
  })

  it('일치 → 통과', async () => {
    headerGet.mockReturnValue('sp-y')
    expect(await resolveSpaceContext()).toMatchObject({ space: { id: 'sp-y' } })
    expect(await resolveRequestedSpaceContext(null)).toMatchObject({ space: { id: 'sp-y' } })
  })

  it('헤더 없음 → 쿠키 기준 기존 동작', async () => {
    headerGet.mockReturnValue(null)
    expect(await resolveRequestedSpaceContext(null)).toMatchObject({ space: { id: 'sp-y' } })
  })

  it('명시 requested 가 있으면 헤더 무시', async () => {
    headerGet.mockReturnValue('sp-x')
    expect(await resolveRequestedSpaceContext('sp-y')).toMatchObject({ space: { id: 'sp-y' } })
  })
})
