/** @jest-environment node */
const cookieStore = { get: jest.fn() }
jest.mock('next/headers', () => ({ cookies: async () => cookieStore }))
jest.mock('@/lib/prisma', () => ({ prisma: { spaceMember: { findMany: jest.fn() } } }))
import { prisma } from '@/lib/prisma'
import { resolveCurrentMembership } from '../current-space'
import { collectServerTimings } from '@/lib/coupang-ads/server-timing'

const findMany = prisma.spaceMember.findMany as jest.Mock
const m = (id: string, role: string, day: number) => ({
  role,
  createdAt: new Date(2026, 0, day),
  space: { id, name: `Space ${id}` },
})

beforeEach(() => {
  jest.resetAllMocks()
  cookieStore.get.mockReturnValue(undefined)
})

it('멤버십 조회와 쿠키 확인의 대기 시간을 식별자 없이 수집한다', async () => {
  findMany.mockResolvedValue([m('a', 'OWNER', 1)])
  const { result, timings } = await collectServerTimings(() => resolveCurrentMembership('u'))
  expect(result).toMatchObject({ space: { id: 'a' }, role: 'OWNER' })
  expect(timings.membership_list).toEqual(expect.any(Number))
  expect(timings.membership_cookie).toEqual(expect.any(Number))
  expect(JSON.stringify(timings)).not.toContain('Space a')
})

it('멤버십이 없으면 null', async () => {
  findMany.mockResolvedValue([])
  expect(await resolveCurrentMembership('u')).toBeNull()
})

it('쿠키가 없으면 OWNER 최고참, OWNER 가 없으면 최고참', async () => {
  findMany.mockResolvedValue([m('a', 'ADMIN', 1), m('b', 'OWNER', 2), m('c', 'OWNER', 3)])
  expect(await resolveCurrentMembership('u')).toMatchObject({ space: { id: 'b' }, role: 'OWNER' })
  findMany.mockResolvedValue([m('a', 'ADMIN', 1), m('b', 'MEMBER', 2)])
  expect(await resolveCurrentMembership('u')).toMatchObject({ space: { id: 'a' } })
})

it('쿠키가 구성원 Space 면 그 Space', async () => {
  findMany.mockResolvedValue([m('a', 'OWNER', 1), m('b', 'MEMBER', 2)])
  cookieStore.get.mockReturnValue({ value: 'b' })
  expect(await resolveCurrentMembership('u')).toMatchObject({ space: { id: 'b' }, role: 'MEMBER' })
})

it('쿠키가 비구성원(내보내짐·조작) Space 면 무시하고 기본값', async () => {
  findMany.mockResolvedValue([m('a', 'OWNER', 1)])
  cookieStore.get.mockReturnValue({ value: 'x' })
  expect(await resolveCurrentMembership('u')).toMatchObject({ space: { id: 'a' } })
})

it('requested 가 구성원이면 쿠키보다 우선, 비구성원이면 forbidden', async () => {
  findMany.mockResolvedValue([m('a', 'OWNER', 1), m('b', 'ADMIN', 2)])
  cookieStore.get.mockReturnValue({ value: 'a' })
  expect(await resolveCurrentMembership('u', 'b')).toMatchObject({ space: { id: 'b' } })
  expect(await resolveCurrentMembership('u', 'x')).toEqual({ forbidden: true })
})
