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
jest.mock('@/lib/billing/entitlement', () => ({ resolveEntitlement: jest.fn() }))
jest.mock('@/components/my-deck/my-deck-client', () => ({ MyDeckClient: () => null }))
jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
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

it('?spaceId의 구성원이면 그 Space를 보여준다', async () => {
  findFirst.mockImplementation(({ where }) => Promise.resolve(member(where.spaceId ?? 'sp-first')))
  expect((await render('sp-1')).props.spaceName).toBe('sp-1')
  expect(findFirst).toHaveBeenCalledTimes(1)
  expect(findFirst.mock.calls[0][0].where).toEqual({ userId: 'u', spaceId: 'sp-1' })
})

it('?spaceId의 구성원이 아니면 첫 멤버십으로 돌아간다', async () => {
  findFirst.mockImplementation(({ where }) =>
    Promise.resolve(where.spaceId ? null : member('sp-first'))
  )
  expect((await render('sp-other')).props.spaceName).toBe('sp-first')
  expect(findFirst.mock.calls[1][0].where).toEqual({ userId: 'u' })
})

it('spaceId 없으면 기존처럼 첫 멤버십, 멤버십 없으면 /workspace-setup', async () => {
  findFirst.mockResolvedValueOnce(member('sp-first'))
  expect((await render()).props.spaceName).toBe('sp-first')
  expect(findFirst.mock.calls[0][0].where).toEqual({ userId: 'u' })
  findFirst.mockResolvedValue(null)
  await expect(render()).rejects.toThrow('redirect:/workspace-setup')
})
