import { requireDeckAccess } from '@/lib/billing/deck-layout-guard'
import { DeckShell } from '@/components/layout/deck-shell'
import { measureCoupangAds, withCoupangAdsPageTiming } from '@/lib/coupang-ads/server-timing'

export default async function CoupangAdsLayout({ children }: { children: React.ReactNode }) {
  return withCoupangAdsPageTiming(async () => {
    const { spaceName, readOnlyNotice } = await measureCoupangAds('layout_guard', () =>
      requireDeckAccess('coupang-ads')
    )
    return (
      <DeckShell workspaceName={spaceName} variant="coupang-ads" readOnlyNotice={readOnlyNotice}>
        {children}
      </DeckShell>
    )
  })
}
