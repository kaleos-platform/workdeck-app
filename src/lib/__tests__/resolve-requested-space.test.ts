/** @jest-environment node */
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: { spaceMember: { findMany: jest.fn() } } }))
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { resolveRequestedSpaceContext } from '@/lib/api-helpers'

const findMany = prisma.spaceMember.findMany as jest.Mock
const TWO = [
  { role: 'ADMIN', space: { id: 'sp-aml', name: '의식주의' } },
  { role: 'ADMIN', space: { id: 'sp-kaleos', name: 'Kaleos' } },
]

beforeEach(() => {
  jest.clearAllMocks()
  ;(getUser as jest.Mock).mockResolvedValue({ id: 'u-sangwon' })
})

it('두 Space 사용자 + 선택 없음 → 400 SPACE_REQUIRED(최고참으로 떨어지지 않음)', async () => {
  findMany.mockResolvedValue(TWO)
  const r = await resolveRequestedSpaceContext(null)
  if (!('error' in r)) throw new Error('error 기대')
  expect(r.error.status).toBe(400)
  await expect(r.error.json()).resolves.toMatchObject({
    code: 'SPACE_REQUIRED',
    spaces: [
      { id: 'sp-aml', name: '의식주의', role: 'ADMIN' },
      { id: 'sp-kaleos', name: 'Kaleos', role: 'ADMIN' },
    ],
  })
})

it('선택한 Space의 구성원이면 그 Space와 역할', async () => {
  findMany.mockResolvedValue(TWO)
  await expect(resolveRequestedSpaceContext('sp-kaleos')).resolves.toMatchObject({
    space: { id: 'sp-kaleos' },
    role: 'ADMIN',
  })
})

it('구성원이 아닌 Space를 고르면 403', async () => {
  findMany.mockResolvedValue(TWO)
  const r = await resolveRequestedSpaceContext('sp-other')
  expect('error' in r && r.error.status).toBe(403)
})

it('단일 Space 사용자는 선택 없이 그 Space(기존 동작)', async () => {
  findMany.mockResolvedValue([TWO[0]])
  await expect(resolveRequestedSpaceContext(null)).resolves.toMatchObject({
    space: { id: 'sp-aml' },
  })
})

it('로그인하지 않으면 401', async () => {
  ;(getUser as jest.Mock).mockResolvedValue(null)
  const r = await resolveRequestedSpaceContext('sp-aml')
  expect('error' in r && r.error.status).toBe(401)
})
