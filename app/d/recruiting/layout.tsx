import { requireDeckAccess } from '@/lib/billing/deck-layout-guard'
import { DeckShell } from '@/components/layout/deck-shell'
import { collectServerTimings } from '@/lib/coupang-ads/server-timing'

async function loadAccess() {
  const { result, timings } = await collectServerTimings(() => requireDeckAccess('recruiting'))
  const user = timings.layout_user
  const context = timings.layout_context
  const entitlement = timings.layout_entitlement
  if ((user ?? 0) + (context ?? 0) + (entitlement ?? 0) >= 500) {
    // 식별자 없이 각 단계에서 기다린 시간만 기록한다.
    console.info('[recruiting:layout:slow]', {
      userMs: user === undefined ? null : Math.round(user),
      contextMs: context === undefined ? null : Math.round(context),
      entitlementMs: entitlement === undefined ? null : Math.round(entitlement),
      membershipListMs:
        timings.membership_list === undefined ? null : Math.round(timings.membership_list),
      membershipCookieMs:
        timings.membership_cookie === undefined ? null : Math.round(timings.membership_cookie),
    })
  }
  return result
}

export default async function RecruitingLayout({ children }: { children: React.ReactNode }) {
  const { spaceName } = await loadAccess()

  return (
    <DeckShell workspaceName={spaceName} variant="recruiting" dataDeck="recruiting">
      {children}
    </DeckShell>
  )
}
