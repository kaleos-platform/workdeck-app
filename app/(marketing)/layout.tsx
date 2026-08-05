import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/react'
import { MarketingHeader } from '@/components/marketing/marketing-header'
import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { getMarketingOrigin } from '@/lib/domain'

export const metadata: Metadata = {
  metadataBase: new URL(getMarketingOrigin()),
  title: {
    template: '%s | Workdeck',
    default: 'Workdeck — 여러 비즈니스 업무를 하나의 워크스페이스로',
  },
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
      <Analytics />
      {/* GA4 삽입 지점 */}
    </div>
  )
}
