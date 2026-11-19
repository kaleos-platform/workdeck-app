/** @jest-environment node */
import { canUseDeck, ensureTrialStarted } from '@/lib/billing/entitlement'
import { findClosedDecks } from '@/lib/billing/deck-release'
import { EnableDeckError, enableDeckInTx } from '../enable-deck'

jest.mock('@/lib/billing/entitlement', () => ({
  canUseDeck: jest.fn(),
  ensureTrialStarted: jest.fn(),
}))
jest.mock('@/lib/billing/deck-release', () => ({ findClosedDecks: jest.fn() }))

const tx = {
  deckInstance: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
}
const run = () => enableDeckInTx(tx as never, 's1', 'recruiting')

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(findClosedDecks).mockResolvedValue([])
  jest.mocked(canUseDeck).mockResolvedValue(true)
  tx.deckInstance.findUnique.mockResolvedValue(null)
  tx.deckInstance.create.mockResolvedValue({ id: 'i1', deckAppId: 'recruiting', isActive: true })
})

it('새 Space 에는 체험 시작 후 DeckInstance 를 만든다', async () => {
  const result = await run()
  expect(ensureTrialStarted).toHaveBeenCalledWith('s1', 'recruiting', tx)
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
