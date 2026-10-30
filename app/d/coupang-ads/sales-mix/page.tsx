import { redirect } from 'next/navigation'
import { resolveWorkspace } from '@/lib/api-helpers'
import { getUser } from '@/hooks/use-user'
import { hasSpaceAccess } from '@/lib/workspace-shell'
import { getDaysAgoStrKst } from '@/lib/date-range'
import { querySalesMix } from '@/lib/coupang-ads/sales-mix-query'
import { measureCoupangAds, withCoupangAdsPageTiming } from '@/lib/coupang-ads/server-timing'
import {
  SalesMixClient,
  type SalesMixResponse,
} from '@/components/coupang-ads/sales-mix/sales-mix-client'

async function renderSalesMixPage() {
  const resolved = await measureCoupangAds('auth', resolveWorkspace)
  if (resolved.error) {
    if (resolved.error.status === 401) redirect('/login')
    if (resolved.error.status === 404) {
      // 초대로 합류한 구성원은 Workspace가 없다 — 설정 대신 my-deck으로.
      const user = await getUser()
      redirect(user && (await hasSpaceAccess(user.id)) ? '/my-deck' : '/workspace-setup')
    }
    redirect('/my-deck')
  }

  const from = getDaysAgoStrKst(30)
  const to = getDaysAgoStrKst(1)
  let initialData: SalesMixResponse | undefined
  try {
    initialData = await measureCoupangAds('sales_mix', () =>
      querySalesMix(resolved.workspace.id, { startDate: from, endDate: to })
    )
  } catch {
    // 서버 초기 조회 실패는 클라이언트 조회로 재시도한다.
  }

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">매출 구성</h1>
        <p className="text-sm text-muted-foreground">
          광고비 비중 = 광고비 ÷ 판매분석 전체 매출. 쿠팡 기준 광고매출은 클릭 후 1일 내 구매를 모두
          포함합니다. 광고비는 쿠팡 광고 리포트 기준입니다.
        </p>
      </div>
      <SalesMixClient initialFrom={from} initialTo={to} initialData={initialData} />
    </div>
  )
}

export default function CoupangAdsSalesMixPage() {
  return withCoupangAdsPageTiming(renderSalesMixPage)
}
