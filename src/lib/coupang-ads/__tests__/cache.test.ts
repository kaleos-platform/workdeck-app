/** @jest-environment node */

const unstableCacheMock = jest.fn()
const revalidateTagMock = jest.fn()

jest.mock('next/cache', () => ({
  unstable_cache: (...args: unknown[]) => unstableCacheMock(...args),
  revalidateTag: (...args: unknown[]) => revalidateTagMock(...args),
}))

import {
  cacheCoupangAdsData,
  getCoupangAdsWorkspaceTag,
  invalidateCoupangAdsCache,
} from '@/lib/coupang-ads/cache'

describe('coupang-ads cache', () => {
  beforeEach(() => {
    unstableCacheMock.mockReset()
    revalidateTagMock.mockReset()
  })

  test('workspace별 tag와 입력별 cache key를 구성한다', async () => {
    const loader = jest.fn().mockResolvedValue({ ok: true })
    const cached = jest.fn().mockResolvedValue({ ok: true })
    unstableCacheMock.mockReturnValue(cached)

    const result = await cacheCoupangAdsData(
      'overview',
      {
        workspaceId: 'workspace-1',
        campaignId: 'campaign-1',
        from: '2026-05-01',
        to: '2026-05-07',
        adType: 'all',
      },
      loader
    )

    expect(result).toEqual({ ok: true })
    expect(unstableCacheMock).toHaveBeenCalledWith(
      loader,
      ['coupang-ads', 'overview', 'workspace-1', 'campaign-1', '2026-05-01', '2026-05-07', 'all'],
      {
        revalidate: 3600,
        tags: ['coupang-ads:workspace-1'],
      }
    )
    expect(cached).toHaveBeenCalledTimes(1)
  })

  test('쓰기 성공 후 workspace cache를 즉시 만료한다', () => {
    invalidateCoupangAdsCache('workspace-1')

    expect(getCoupangAdsWorkspaceTag('workspace-1')).toBe('coupang-ads:workspace-1')
    expect(revalidateTagMock).toHaveBeenCalledWith('coupang-ads:workspace-1', { expire: 0 })
  })
})
