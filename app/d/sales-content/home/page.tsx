import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Lightbulb,
  FileEdit,
  Send,
  BarChart3,
  Sparkles,
  ArrowRight,
  Package,
  Users,
  Palette,
} from 'lucide-react'
import {
  SALES_CONTENT_PRODUCTS_PATH,
  SALES_CONTENT_PERSONAS_PATH,
  SALES_CONTENT_BRAND_PROFILE_PATH,
  SALES_CONTENT_IDEATION_PATH,
  SALES_CONTENT_CONTENTS_PATH,
  SALES_CONTENT_DEPLOYMENTS_PATH,
  SALES_CONTENT_ANALYTICS_PATH,
  SALES_CONTENT_RULES_PATH,
} from '@/lib/deck-routes'

const QUICK_STEPS = [
  {
    step: '1',
    title: '정보 세팅',
    description:
      '판매 상품·타겟 페르소나·브랜드 프로필을 먼저 채워주세요. 아이데이션 품질의 기반입니다.',
    icon: Package,
    links: [
      { label: '상품', href: SALES_CONTENT_PRODUCTS_PATH },
      { label: '페르소나', href: SALES_CONTENT_PERSONAS_PATH },
      { label: '브랜드 프로필', href: SALES_CONTENT_BRAND_PROFILE_PATH },
    ],
  },
  {
    step: '2',
    title: '아이데이션',
    description: 'AI가 글감 후보를 제안하고, 원하는 만큼 직접 추가·수정합니다.',
    icon: Lightbulb,
    links: [{ label: '아이데이션 시작', href: SALES_CONTENT_IDEATION_PATH }],
  },
  {
    step: '3',
    title: '콘텐츠 제작',
    description: '채널 템플릿에 맞춰 본문과 이미지 슬롯을 채우고 검수합니다.',
    icon: FileEdit,
    links: [{ label: '콘텐츠 목록', href: SALES_CONTENT_CONTENTS_PATH }],
  },
  {
    step: '4',
    title: '배포',
    description: '채널별 자격증명을 등록하면 예약 배포를 사용할 수 있습니다.',
    icon: Send,
    links: [{ label: '배포 관리', href: SALES_CONTENT_DEPLOYMENTS_PATH }],
  },
  {
    step: '5',
    title: '성과·개선 규칙',
    description: '채널별 지표와 셀프-임프루빙 규칙이 다음 아이데이션에 자동 반영됩니다.',
    icon: BarChart3,
    links: [
      { label: '성과', href: SALES_CONTENT_ANALYTICS_PATH },
      { label: '개선 규칙', href: SALES_CONTENT_RULES_PATH },
    ],
  },
]

export default function SalesContentHomePage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">세일즈 콘텐츠</h1>
          <Badge variant="outline" className="text-xs">
            PoC
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          B2B·B2G 세일즈 리드 창출을 위한 콘텐츠 제작·배포·성과 관리를 한 곳에서.
        </p>
      </header>

      <Card className="bg-gradient-to-br from-fuchsia-50 via-background to-indigo-50 dark:from-fuchsia-950/20 dark:via-background dark:to-indigo-950/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-fuchsia-500" />
            <CardTitle className="text-base">첫 콘텐츠를 만드는 가장 빠른 길</CardTitle>
          </div>
          <CardDescription>
            각 단계는 독립적으로 작업할 수 있지만, 순서대로 진행하면 AI 품질이 가장 좋습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {QUICK_STEPS.map((item) => {
            const Icon = item.icon
            return (
              <div
                key={item.step}
                className="flex items-start gap-4 rounded-lg border bg-background/80 p-4"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-muted">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-semibold">
                      STEP {item.step}
                    </span>
                    <h3 className="text-sm font-semibold">{item.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {item.links.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
                      >
                        {link.label}
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">타겟 페르소나</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">—</p>
            <p className="text-xs text-muted-foreground">설정된 페르소나가 없습니다</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
            <Palette className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">월간 이미지 크레딧</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">—</p>
            <p className="text-xs text-muted-foreground">AI 어댑터 연결 후 표시</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">이번 달 배포된 콘텐츠</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">0</p>
            <p className="text-xs text-muted-foreground">배포가 완료되면 집계됩니다</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
