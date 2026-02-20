import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { UploadCloud, DollarSign, TrendingUp, MousePointerClick } from 'lucide-react'

// TODO: 실제 데이터 fetching으로 교체 (Prisma + Supabase 사용자 기반)
const kpiCards = [
  {
    title: '총 광고비',
    value: '-',
    description: '업로드된 데이터 기준',
    icon: DollarSign,
    color: 'text-orange-500',
  },
  {
    title: '평균 ROAS (14일)',
    value: '-',
    description: '업로드된 데이터 기준',
    icon: TrendingUp,
    color: 'text-green-600',
  },
  {
    title: '총 클릭수',
    value: '-',
    description: '업로드된 데이터 기준',
    icon: MousePointerClick,
    color: 'text-blue-600',
  },
]

export default async function DashboardPage() {
  // TODO: Prisma를 통해 워크스페이스 및 업로드 이력 조회
  const hasData = false
  const uploadHistory: { id: string; fileName: string; uploadedAt: Date; periodStart: Date; periodEnd: Date }[] = []

  return (
    <div className="space-y-8">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">대시보드</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
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
              <p className="text-gray-600 dark:text-gray-400 text-sm max-w-sm">
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
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {card.description}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 업로드 이력 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">업로드 이력</CardTitle>
        </CardHeader>
        <CardContent>
          {uploadHistory.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              업로드된 리포트가 없습니다
            </p>
          ) : (
            <div className="space-y-2">
              {uploadHistory.map((upload) => (
                <div key={upload.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium">{upload.fileName}</p>
                    <p className="text-xs text-gray-500">
                      {upload.periodStart.toLocaleDateString('ko-KR')} ~ {upload.periodEnd.toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500">
                    {upload.uploadedAt.toLocaleDateString('ko-KR')}
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
