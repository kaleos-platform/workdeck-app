/** @jest-environment node */
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceMember: { findFirst: jest.fn() },
    spaceSubscription: { findUnique: jest.fn() },
    billingDeckProduct: { findMany: jest.fn() },
    billingMethod: { findFirst: jest.fn() },
    deckApp: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/spaces/current-space', () => ({ resolveCurrentMembership: jest.fn() }))
jest.mock('@/lib/billing/entitlement', () => ({ resolveEntitlement: jest.fn() }))
jest.mock('@/components/my-deck/my-deck-client', () => ({ MyDeckClient: () => null }))
jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { resolveCurrentMembership } from '@/lib/spaces/current-space'
import { resolveEntitlement } from '@/lib/billing/entitlement'
import MyDeckPage from '../page'

const findFirst = prisma.spaceMember.findFirst as jest.Mock
const member = (id: string) => ({ role: 'MEMBER', space: { id, name: id, deckInstances: [] } })
const render = async (spaceId?: string) =>
  (await MyDeckPage({ searchParams: Promise.resolve({ spaceId }) })) as unknown as {
    props: { spaceName: string }
  }

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getUser).mockResolvedValue({ id: 'u' } as never)
  jest.mocked(prisma.spaceSubscription.findUnique).mockResolvedValue(null)
  jest.mocked(prisma.billingDeckProduct.findMany).mockResolvedValue([])
  jest.mocked(prisma.billingMethod.findFirst).mockResolvedValue(null)
  jest.mocked(prisma.deckApp.findMany).mockResolvedValue([])
  jest.mocked(resolveEntitlement).mockResolvedValue({ decks: {} } as never)
})

const resolve = resolveCurrentMembership as jest.Mock
const cur = (id: string) => ({ role: 'MEMBER', space: { id, name: id } })

it('?spaceId의 구성원이면 그 Space를 보여준다', async () => {
  resolve.mockResolvedValue(cur('sp-1'))
  findFirst.mockImplementation(({ where }) => Promise.resolve(member(where.spaceId)))
  expect((await render('sp-1')).props.spaceName).toBe('sp-1')
  expect(resolve).toHaveBeenCalledWith('u', 'sp-1')
  expect(findFirst.mock.calls[0][0].where).toEqual({ userId: 'u', spaceId: 'sp-1' })
})

it('?spaceId의 구성원이 아니면(forbidden) 기본 Space로 돌아간다', async () => {
  resolve.mockResolvedValueOnce({ forbidden: true }).mockResolvedValueOnce(cur('sp-first'))
  findFirst.mockImplementation(({ where }) => Promise.resolve(member(where.spaceId)))
  expect((await render('sp-other')).props.spaceName).toBe('sp-first')
  expect(resolve).toHaveBeenLastCalledWith('u')
})

it('멤버십 없으면 /workspace-setup', async () => {
  resolve.mockResolvedValue(null)
  await expect(render()).rejects.toThrow('redirect:/workspace-setup')
})
