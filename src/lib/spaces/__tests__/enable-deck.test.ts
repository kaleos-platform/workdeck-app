/** @jest-environment node */
import { canUseDeck, ensureTrialStarted } from '@/lib/billing/entitlement'
import { findClosedDecks } from '@/lib/billing/deck-release'
import { lockOwnerSpaces } from '@/lib/spaces/owner-space-lock'
import { EnableDeckError, enableDeckInTx } from '../enable-deck'

jest.mock('@/lib/billing/entitlement', () => ({
  canUseDeck: jest.fn(),
  ensureTrialStarted: jest.fn(),
}))
jest.mock('@/lib/billing/deck-release', () => ({ findClosedDecks: jest.fn() }))
jest.mock('@/lib/spaces/owner-space-lock', () => ({ lockOwnerSpaces: jest.fn() }))

const tx = {
  deckInstance: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  spaceMember: { findMany: jest.fn() },
}
const run = () => enableDeckInTx(tx as never, 's1', 'recruiting')

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(findClosedDecks).mockResolvedValue([])
  jest.mocked(canUseDeck).mockResolvedValue(true)
  tx.deckInstance.findUnique.mockResolvedValue(null)
  tx.spaceMember.findMany.mockResolvedValue([{ userId: 'u-1' }, { userId: 'u-2' }])
  tx.deckInstance.create.mockResolvedValue({ id: 'i1', deckAppId: 'recruiting', isActive: true })
})

it('새 Space 에는 체험 시작 후 DeckInstance 를 만든다', async () => {
  const result = await run()
  expect(ensureTrialStarted).toHaveBeenCalledWith('s1', 'recruiting', tx, {})
  expect(tx.deckInstance.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: { spaceId: 's1', deckAppId: 'recruiting', isActive: true } })
  )
  expect(result.reactivated).toBe(false)
})

it('비활성 인스턴스는 재활성한다', async () => {
  tx.deckInstance.findUnique.mockResolvedValue({ id: 'i0', isActive: false })
  tx.deckInstance.update.mockResolvedValue({ id: 'i0', deckAppId: 'recruiting', isActive: true })
  expect((await run()).reactivated).toBe(true)
  expect(tx.deckInstance.create).not.toHaveBeenCalled()
})

it.each([
  ['DECK_CLOSED', () => jest.mocked(findClosedDecks).mockResolvedValue(['recruiting'])],
  [
    'DECK_ALREADY_ACTIVE',
    () => tx.deckInstance.findUnique.mockResolvedValue({ id: 'i0', isActive: true }),
  ],
  ['DECK_SUBSCRIPTION_REQUIRED', () => jest.mocked(canUseDeck).mockResolvedValue(false)],
])('%s 는 EnableDeckError 로 던지고 인스턴스를 만들지 않는다', async (code, arrange) => {
  arrange()
  await expect(run()).rejects.toMatchObject({ code })
  await expect(run()).rejects.toBeInstanceOf(EnableDeckError)
  expect(tx.deckInstance.create).not.toHaveBeenCalled()
})

it('준비중이면 체험을 시작하지 않는다', async () => {
  jest.mocked(findClosedDecks).mockResolvedValue(['recruiting'])
  await expect(run()).rejects.toBeInstanceOf(EnableDeckError)
  expect(ensureTrialStarted).not.toHaveBeenCalled()
})

it('체험 판정 전에 OWNER 마다 id 순으로 lock 을 잡고 같은 tx 를 쓴다', async () => {
  const order: string[] = []
  jest.mocked(lockOwnerSpaces).mockImplementation(async (_tx, id) => void order.push(`lock:${id}`))
  jest.mocked(ensureTrialStarted).mockImplementation(async () => void order.push('trial'))
  await run()
  expect(tx.spaceMember.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { spaceId: 's1', role: 'OWNER' }, orderBy: { userId: 'asc' } })
  )
  expect(lockOwnerSpaces).toHaveBeenCalledWith(tx, 'u-1')
  expect(order).toEqual(['lock:u-1', 'lock:u-2', 'trial'])
})

it('trialOncePerOwner:false 면 옵션을 그대로 넘기고 lock 은 호출자 몫이다(어드민)', async () => {
  await enableDeckInTx(tx as never, 's1', 'recruiting', { trialOncePerOwner: false })
  expect(ensureTrialStarted).toHaveBeenCalledWith('s1', 'recruiting', tx, {
    trialOncePerOwner: false,
  })
  expect(lockOwnerSpaces).not.toHaveBeenCalled()
})
