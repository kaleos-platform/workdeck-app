import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { UploadCloud, DollarSign, TrendingUp, MousePointerClick, FileSpreadsheet } from 'lucide-react'
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

export default async function DashboardPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const workspace = await prisma.workspace.findUnique({
    where: { ownerId: user.id },
    select: { id: true },
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

  // KPI 전체 합산
  const kpiAgg = await prisma.adRecord.aggregate({
    where: { workspaceId: workspace.id },
    _sum: { adCost: true, clicks: true, impressions: true },
    _avg: { roas14d: true },
  })

  // 업로드 이력 (최근 10건)
  const uploadRows = await prisma.reportUpload.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { uploadedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      fileName: true,
      uploadedAt: true,
      periodStart: true,
      periodEnd: true,
    },
  })

  const hasData = campaigns.length > 0

  const kpi = {
    totalAdCost: Number(kpiAgg._sum.adCost ?? 0),
    avgRoas14d: Number(kpiAgg._avg.roas14d ?? 0),
    totalClicks: Number(kpiAgg._sum.clicks ?? 0),
    totalImpressions: Number(kpiAgg._sum.impressions ?? 0),
  }

  // 날짜 포맷 헬퍼
  function fmt(d: Date): string {
    return d.toISOString().split('T')[0]
  }

  const kpiCards = [
    {
      title: '총 광고비',
      value: `${kpi.totalAdCost.toLocaleString()}원`,
      description: '전체 업로드 데이터 기준',
      icon: DollarSign,
      color: 'text-orange-500',
    },
    {
      title: '평균 ROAS (14일)',
      value: `${kpi.avgRoas14d.toFixed(1)}%`,
      description: '전체 업로드 데이터 기준',
      icon: TrendingUp,
      color: 'text-green-600',
    },
    {
      title: '총 클릭수',
      value: kpi.totalClicks.toLocaleString(),
      description: '전체 업로드 데이터 기준',
      icon: MousePointerClick,
      color: 'text-blue-600',
    },
  ]

  return (
    <div className="space-y-8">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">대시보드</h1>
          <p className="text-muted-foreground mt-1">
            워크스페이스 전체 광고 성과를 확인합니다
          </p>
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
        <Card className="border-dashed border-2 border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20">
          <CardContent className="py-12 flex flex-col items-center text-center gap-4">
            <div className="rounded-full bg-orange-100 dark:bg-orange-900/30 p-4">
              <UploadCloud className="h-8 w-8 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-2">아직 리포트가 없습니다</h3>
              <p className="text-muted-foreground text-sm max-w-sm">
                쿠팡 셀러센터에서 광고 리포트 Excel 파일을 다운로드하여 업로드하세요.
                업로드하면 캠페인별 성과를 바로 분석할 수 있습니다.
              </p>
            </div>
            <Link href="/dashboard/upload">
              <Button className="gap-2">
                <UploadCloud className="h-4 w-4" />
                첫 리포트 업로드하기
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* KPI 카드 */}
      <div className="grid gap-4 md:grid-cols-3">
        {kpiCards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                <Icon className={`h-4 w-4 ${card.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {card.description}
                </p>
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
                  className="flex items-center justify-between py-2.5 px-3 rounded-md border hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium">{campaign.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {campaign.adTypes.join(' · ')}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">상세 보기 →</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 업로드 이력 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">업로드 이력</CardTitle>
        </CardHeader>
        <CardContent>
          {uploadRows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              업로드된 리포트가 없습니다
            </p>
          ) : (
            <div className="space-y-1">
              {uploadRows.map((upload: { id: string; fileName: string; uploadedAt: Date; periodStart: Date; periodEnd: Date }) => (
                <div
                  key={upload.id}
                  className="flex items-center justify-between py-2.5 border-b last:border-0"
                >
                  <div className="flex items-center gap-2.5">
                    <FileSpreadsheet className="h-4 w-4 text-green-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{upload.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmt(upload.periodStart)} ~ {fmt(upload.periodEnd)}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-nowrap ml-4">
                    {fmt(upload.uploadedAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
