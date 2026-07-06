import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Package, Lightbulb, Layers, PenSquare, Globe, Send } from 'lucide-react'
import {
  BLOG_OPS_PRODUCTS_PATH,
  BLOG_OPS_IDEATION_PATH,
  BLOG_OPS_MATERIALS_PATH,
  BLOG_OPS_POSTS_PATH,
  BLOG_OPS_CHANNELS_PATH,
  BLOG_OPS_DEPLOYMENTS_PATH,
} from '@/lib/deck-routes'
import Link from 'next/link'

// 파이프라인 단계별 카드 데이터
const PIPELINE_STAGES = [
  {
    label: '제품 관리',
    icon: Package,
    href: BLOG_OPS_PRODUCTS_PATH,
    description: '블로그 소개 대상 제품',
    countLabel: '등록 제품',
  },
  {
    label: '소구점 발굴',
    icon: Lightbulb,
    href: BLOG_OPS_IDEATION_PATH,
    description: 'AI 소구점 후보 · 글감 아이디어',
    countLabel: '발굴된 소구점',
  },
  {
    label: '소재 관리',
    icon: Layers,
    href: BLOG_OPS_MATERIALS_PATH,
    description: '이미지 · 영상 · 텍스트 소재',
    countLabel: '등록 소재',
  },
  {
    label: '포스트',
    icon: PenSquare,
    href: BLOG_OPS_POSTS_PATH,
    description: '작성 중 · 검수 · 발행 완료',
    countLabel: '전체 포스트',
  },
  {
    label: '채널',
    icon: Globe,
    href: BLOG_OPS_CHANNELS_PATH,
    description: '네이버 블로그 · 티스토리 등',
    countLabel: '연결된 채널',
  },
  {
    label: '배포 이력',
    icon: Send,
    href: BLOG_OPS_DEPLOYMENTS_PATH,
    description: '채널별 발행 이력 · 성과',
    countLabel: '이번 달 배포',
  },
]

export default function BlogOpsHomePage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight">블로그 운영</h1>
          <Badge variant="outline" className="text-xs">
            Beta
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          제품 소구점 발굴부터 소재 제작·채널 배포까지 블로그 운영 파이프라인을 한 곳에서.
        </p>
      </header>

      {/* 파이프라인 단계 카운트 카드 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PIPELINE_STAGES.map((stage) => {
          const Icon = stage.icon
          return (
            <Link key={stage.href} href={stage.href} className="group block">
              <Card className="h-full transition-colors hover:border-foreground/20 hover:bg-muted/50 dark:hover:bg-white/[0.03]">
                <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium">{stage.label}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <p className="text-2xl font-bold">—</p>
                  <p className="text-xs text-muted-foreground">{stage.description}</p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
