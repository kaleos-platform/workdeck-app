import 'server-only'

import { revalidateTag, unstable_cache } from 'next/cache'

type CacheKeyInput = {
  workspaceId: string
  campaignId?: string
  from?: string
  to?: string
  adType?: string
}

export function getCoupangAdsWorkspaceTag(workspaceId: string): string {
  return `coupang-ads:${workspaceId}`
}

export async function cacheCoupangAdsData<T>(
  namespace: string,
  input: CacheKeyInput,
  loader: () => Promise<T>
): Promise<T> {
  const cachedLoader = unstable_cache(
    loader,
    [
      'coupang-ads',
      namespace,
      input.workspaceId,
      input.campaignId ?? '',
      input.from ?? '',
      input.to ?? '',
      input.adType ?? '',
    ],
    {
      revalidate: 3600,
      tags: [getCoupangAdsWorkspaceTag(input.workspaceId)],
    }
  )

  return cachedLoader()
}

export function invalidateCoupangAdsCache(workspaceId: string): void {
  revalidateTag(getCoupangAdsWorkspaceTag(workspaceId), { expire: 0 })
}
