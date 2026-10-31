import RecruitingLayout from '../../../../app/d/recruiting/layout'
import { requireDeckAccess } from '@/lib/billing/deck-layout-guard'
import { recordCoupangAdsTiming } from '@/lib/coupang-ads/server-timing'

jest.mock('@/lib/billing/deck-layout-guard', () => ({ requireDeckAccess: jest.fn() }))
jest.mock('@/components/layout/deck-shell', () => ({ DeckShell: () => null }))

afterEach(() => jest.restoreAllMocks())
it('느린 layout은 사용자 정보 없이 각 대기 시간만 기록한다', async () => {
  ;(requireDeckAccess as jest.Mock).mockImplementationOnce(async () => {
    recordCoupangAdsTiming('layout_user', 100)
    recordCoupangAdsTiming('layout_context', 300)
    recordCoupangAdsTiming('layout_entitlement', 200)
    return { spaceName: 'private-space-name' }
  })
  const log = jest.spyOn(console, 'info').mockImplementation(() => {})
  await RecruitingLayout({ children: null })
  expect(log).toHaveBeenCalledWith('[recruiting:layout:slow]', {
    userMs: 100,
    contextMs: 300,
    entitlementMs: 200,
  })
  expect(JSON.stringify(log.mock.calls)).not.toContain('private')
})
it('빠른 layout은 로그를 남기지 않는다', async () => {
  ;(requireDeckAccess as jest.Mock).mockResolvedValueOnce({ spaceName: 'private' })
  const log = jest.spyOn(console, 'info').mockImplementation(() => {})
  await RecruitingLayout({ children: null })
  expect(log).not.toHaveBeenCalled()
})
