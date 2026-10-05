/** @jest-environment node */
import { createApplicantSearch } from '../application-search-action'
import { resolveDeckContext } from '@/lib/api-helpers'
import { buildApplicantSearchToken } from '../application-search'

jest.mock('@/lib/api-helpers', () => ({ resolveDeckContext: jest.fn() }))
jest.mock('../application-search', () => ({
  buildApplicantSearchToken: jest.fn(() => 'search-token'),
}))
beforeEach(() => jest.clearAllMocks())
it('모집관리 권한이 없으면 검색 HMAC을 생성하지 않는다', async () => {
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({
    error: new Response(null, { status: 403 }),
  })
  await expect(createApplicantSearch('QA')).rejects.toThrow('권한')
  expect(buildApplicantSearchToken).not.toHaveBeenCalled()
})
it('권한 확인 이후에만 검색값을 만든다', async () => {
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 'qa-space' } })
  await expect(createApplicantSearch('QA')).resolves.toBe('search-token')
  expect(resolveDeckContext).toHaveBeenCalledWith('recruiting')
  expect(buildApplicantSearchToken).toHaveBeenCalledWith('QA')
})
