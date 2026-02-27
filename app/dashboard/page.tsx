import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  UploadCloud,
  DollarSign,
  TrendingUp,
  ShoppingCart,
  MousePointerClick,
  Target,
  ArrowUp,
  ArrowDown,
  Minus,
} from 'lucide-react'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'

// campaignId별 캠페인 그룹화
function groupByCampaign(rows: { campaignId: string; campaignName: string; adType: string }[]) {
  const map = new Map<string, { id: string; name: string; adTypes: string[] }>()
  for (const row of rows) {
    if (!map.has(row.campaignId)) {
      map.set(row.campaignId, { id: row.campaignId, name: row.campaignName, adTypes: [] })
    }
    const campaign = map.get(row.campaignId)!
    if (!campaign.adTypes.includes(row.adType)) {
      campaign.adTypes.push(row.adType)
    }
  }
  return Array.from(map.values())
}

// 이번주 월요일 00:00 KST (UTC 기준 반환)
function getThisWeekBoundaries(): { thisWeekStart: Date; thisWeekEnd: Date } {
  const kstOffset = 9 * 60 * 60 * 1000
  const nowUtc = Date.now()
  // KST 기준 현재
  const nowKstMs = nowUtc + kstOffset
  const nowKst = new Date(nowKstMs)
  const dayOfWeek = nowKst.getUTCDay() // 0=일, 1=월, ..., 6=토
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek

  // 이번주 월요일 (KST 00:00)
  const thisMondayKst = new Date(nowKstMs)
  thisMondayKst.setUTCDate(nowKst.getUTCDate() + diffToMonday)
  thisMondayKst.setUTCHours(0, 0, 0, 0)

  // UTC로 변환
  const thisWeekStart = new Date(thisMondayKst.getTime() - kstOffset)

  // 오늘 KST 23:59:59 → UTC
  const todayEndKst = new Date(nowKstMs)
  todayEndKst.setUTCHours(23, 59, 59, 999)
  const thisWeekEnd = new Date(todayEndKst.getTime() - kstOffset)

  return { thisWeekStart, thisWeekEnd }
}

// WoW 증감율 계산 (소수점 1자리, 이전 값이 0이면 null)
function calcWow(current: number, prev: number): number | null {
  if (prev === 0) return null
  return Math.round(((current - prev) / prev) * 1000) / 10
}

// WoW 뱃지 렌더용 데이터 구조
type WowBadge = { diff: number | null }

export default async function DashboardPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const workspace = await prisma.workspace.findUnique({
    where: { ownerId: user.id },
    select: { id: true, name: true },
  })
  if (!workspace) redirect('/workspace-setup')

  // 캠페인 목록
  const campaignRows = await prisma.adRecord.findMany({
    where: { workspaceId: workspace.id },
    select: { campaignId: true, campaignName: true, adType: true },
    distinct: ['campaignId', 'adType'],
    orderBy: { campaignId: 'asc' },
  })
  const campaigns = groupByCampaign(campaignRows)

  // 이번주 / 지난주 날짜 범위
  const { thisWeekStart, thisWeekEnd } = getThisWeekBoundaries()
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000)
  const lastWeekEnd = new Date(thisWeekStart.getTime() - 1)

  // 이번주 집계
  const thisWeekAgg = await prisma.adRecord.aggregate({
    where: {
      workspaceId: workspace.id,
      date: { gte: thisWeekStart, lte: thisWeekEnd },
    },
    _sum: { adCost: true, revenue1d: true, orders1d: true, clicks: true, impressions: true },
  })

  // 지난주 집계
  const lastWeekAgg = await prisma.adRecord.aggregate({
    where: {
      workspaceId: workspace.id,
      date: { gte: lastWeekStart, lte: lastWeekEnd },
    },
    _sum: { adCost: true, revenue1d: true, orders1d: true, clicks: true, impressions: true },
  })

  const hasData = campaigns.length > 0

  // 이번주 수치
  const twAdCost = Number(thisWeekAgg._sum.adCost ?? 0)
  const twRevenue = Number(thisWeekAgg._sum.revenue1d ?? 0)
  const twOrders = Number(thisWeekAgg._sum.orders1d ?? 0)
  const twClicks = Number(thisWeekAgg._sum.clicks ?? 0)
  const twImpressions = Number(thisWeekAgg._sum.impressions ?? 0)

  // 지난주 수치
  const lwAdCost = Number(lastWeekAgg._sum.adCost ?? 0)
  const lwRevenue = Number(lastWeekAgg._sum.revenue1d ?? 0)
  const lwOrders = Number(lastWeekAgg._sum.orders1d ?? 0)
  const lwClicks = Number(lastWeekAgg._sum.clicks ?? 0)
  const lwImpressions = Number(lastWeekAgg._sum.impressions ?? 0)

  // 5개 KPI 계산
  const twRoas = twAdCost > 0 ? (twRevenue / twAdCost) * 100 : null
  const lwRoas = lwAdCost > 0 ? (lwRevenue / lwAdCost) * 100 : null
  const twCtr = twImpressions > 0 ? (twClicks / twImpressions) * 100 : null
  const lwCtr = lwImpressions > 0 ? (lwClicks / lwImpressions) * 100 : null
  const twCvr = twClicks > 0 ? (twOrders / twClicks) * 100 : null
  const lwCvr = lwClicks > 0 ? (lwOrders / lwClicks) * 100 : null

  // WoW 증감율
  const wowAdCost: WowBadge = { diff: calcWow(twAdCost, lwAdCost) }
  const wowRoas: WowBadge = {
    diff: twRoas !== null && lwRoas !== null ? calcWow(twRoas, lwRoas) : null,
  }
  const wowRevenue: WowBadge = { diff: calcWow(twRevenue, lwRevenue) }
  const wowCtr: WowBadge = { diff: twCtr !== null && lwCtr !== null ? calcWow(twCtr, lwCtr) : null }
  const wowCvr: WowBadge = { diff: twCvr !== null && lwCvr !== null ? calcWow(twCvr, lwCvr) : null }

  const kpiCards = [
    {
      title: '총 광고비',
      value: `${twAdCost.toLocaleString('ko-KR')}원`,
      description: '이번 주 기준',
      icon: DollarSign,
      color: 'text-orange-500',
      wow: wowAdCost,
      prevValue: lwAdCost > 0 ? `${lwAdCost.toLocaleString('ko-KR')}원` : null,
    },
    {
      title: '평균 ROAS',
      value: twRoas !== null ? `${twRoas.toFixed(1)}%` : '-',
      description: '이번 주 기준',
      icon: TrendingUp,
      color: 'text-green-600',
      wow: wowRoas,
      prevValue: lwRoas !== null ? `${lwRoas.toFixed(1)}%` : null,
    },
    {
      title: '총 매출액',
      value: `${twRevenue.toLocaleString('ko-KR')}원`,
      description: '이번 주 기준',
      icon: ShoppingCart,
      color: 'text-emerald-600',
      wow: wowRevenue,
      prevValue: lwRevenue > 0 ? `${lwRevenue.toLocaleString('ko-KR')}원` : null,
    },
    {
      title: '평균 CTR',
      value: twCtr !== null ? `${twCtr.toFixed(2)}%` : '-',
      description: '이번 주 기준',
      icon: MousePointerClick,
      color: 'text-blue-600',
      wow: wowCtr,
      prevValue: lwCtr !== null ? `${lwCtr.toFixed(2)}%` : null,
    },
    {
      title: '평균 CVR',
      value: twCvr !== null ? `${twCvr.toFixed(2)}%` : '-',
      description: '이번 주 기준',
      icon: Target,
      color: 'text-purple-600',
      wow: wowCvr,
      prevValue: lwCvr !== null ? `${lwCvr.toFixed(2)}%` : null,
    },
  ]

  return (
    <div className="space-y-8">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{workspace.name}</h1>
        </div>
        <Link href="/dashboard/upload">
          <Button className="gap-2">
            <UploadCloud className="h-4 w-4" />
            리포트 업로드
          </Button>
        </Link>
      </div>

      {/* 데이터 없을 때 CTA 배너 */}
      {!hasData && (
        <Card className="border-2 border-dashed border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="rounded-full bg-orange-100 p-4 dark:bg-orange-900/30">
              <UploadCloud className="h-8 w-8 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold">아직 리포트가 없습니다</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                쿠팡 셀러센터에서 광고 리포트 Excel 파일을 다운로드하여 업로드하세요. 업로드하면
                캠페인별 성과를 바로 분석할 수 있습니다.
              </p>
            </div>
            <Link href="/dashboard/upload">
              <Button className="gap-2">
                <UploadCloud className="h-4 w-4" />첫 리포트 업로드하기
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* KPI 카드 5개 (이번 주 기준 + WoW 증감) */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {kpiCards.map((card) => {
          const Icon = card.icon
          const diff = card.wow.diff
          return (
            <Card key={card.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                <Icon className={`h-4 w-4 ${card.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
                <div className="mt-1 flex items-center gap-1">
                  {diff === null ? (
                    <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                      <Minus className="h-3 w-3" />
                      지난주 데이터 없음
                    </span>
                  ) : diff > 0 ? (
                    <span className="flex items-center gap-0.5 text-xs text-green-600">
                      <ArrowUp className="h-3 w-3" />+{diff}% 지난주 대비
                    </span>
                  ) : diff < 0 ? (
                    <span className="flex items-center gap-0.5 text-xs text-red-500">
                      <ArrowDown className="h-3 w-3" />
                      {diff}% 지난주 대비
                    </span>
                  ) : (
                    <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                      <Minus className="h-3 w-3" />
                      변동 없음
                    </span>
                  )}
                </div>
                {card.prevValue !== null && (
                  <p className="mt-0.5 text-xs text-muted-foreground">지난주: {card.prevValue}</p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 캠페인 목록 요약 */}
      {hasData && campaigns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">캠페인 목록</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {campaigns.map((campaign) => (
                <Link
                  key={campaign.id}
                  href={`/dashboard/campaigns/${campaign.id}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <div>
                    <p className="text-sm font-medium">{campaign.name}</p>
                    <p className="text-xs text-muted-foreground">{campaign.adTypes.join(' · ')}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">상세 보기 →</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
