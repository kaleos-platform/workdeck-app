import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Package, Layers, PenSquare } from 'lucide-react'
import {
  BLOG_OPS_PRODUCTS_PATH,
  BLOG_OPS_MATERIALS_PATH,
  BLOG_OPS_POSTS_PATH,
} from '@/lib/deck-routes'

export default async function BlogOpsHomePage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) redirect('/my-deck')

  const spaceId = resolved.space.id

  // 제품 수
  const [productCount, materialCounts, postCounts] = await Promise.all([
    prisma.boProduct.count({ where: { spaceId, isActive: true } }),
    prisma.boMaterial.groupBy({
      by: ['status'],
      where: { spaceId },
      _count: { _all: true },
    }),
    prisma.boPost.groupBy({
      by: ['status'],
      where: { spaceId },
      _count: { _all: true },
    }),
  ])

  // 소재 상태별 카운트 맵
  const matCount = Object.fromEntries(
    materialCounts.map((r) => [r.status, r._count._all])
  ) as Record<string, number>

  // 포스트 상태별 카운트 맵
  const postCount = Object.fromEntries(postCounts.map((r) => [r.status, r._count._all])) as Record<
    string,
    number
  >

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

      {/* 파이프라인 현황 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* 제품 */}
        <Link href={BLOG_OPS_PRODUCTS_PATH} className="group block">
          <Card className="h-full transition-colors hover:border-foreground/20 hover:bg-muted/50 dark:hover:bg-white/[0.03]">
            <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">제품</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{productCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">활성 제품</p>
            </CardContent>
          </Card>
        </Link>

        {/* 소재 — PROPOSED */}
        <Link href={`${BLOG_OPS_MATERIALS_PATH}?status=PROPOSED`} className="group block">
          <Card className="h-full transition-colors hover:border-foreground/20 hover:bg-muted/50 dark:hover:bg-white/[0.03]">
            <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
              <Layers className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm font-medium">소재 — 검토 대기</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{matCount['PROPOSED'] ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">승인 전 소재</p>
            </CardContent>
          </Card>
        </Link>

        {/* 소재 — APPROVED */}
        <Link href={`${BLOG_OPS_MATERIALS_PATH}?status=APPROVED`} className="group block">
          <Card className="h-full transition-colors hover:border-foreground/20 hover:bg-muted/50 dark:hover:bg-white/[0.03]">
            <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
              <Layers className="h-4 w-4 text-emerald-500" />
              <CardTitle className="text-sm font-medium">소재 — 승인</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{matCount['APPROVED'] ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">초안 생성 가능 소재</p>
            </CardContent>
          </Card>
        </Link>

        {/* 포스트 — 초안 */}
        <Link href={`${BLOG_OPS_POSTS_PATH}?status=DRAFT`} className="group block">
          <Card className="h-full transition-colors hover:border-foreground/20 hover:bg-muted/50 dark:hover:bg-white/[0.03]">
            <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
              <PenSquare className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">포스트 — 초안</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{postCount['DRAFT'] ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">작성 중 포스트</p>
            </CardContent>
          </Card>
        </Link>

        {/* 포스트 — 검토 중 */}
        <Link href={`${BLOG_OPS_POSTS_PATH}?status=IN_REVIEW`} className="group block">
          <Card className="h-full transition-colors hover:border-foreground/20 hover:bg-muted/50 dark:hover:bg-white/[0.03]">
            <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
              <PenSquare className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm font-medium">포스트 — 검토 중</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{postCount['IN_REVIEW'] ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">검토 대기 포스트</p>
            </CardContent>
          </Card>
        </Link>

        {/* 포스트 — 발행 승인 */}
        <Link href={`${BLOG_OPS_POSTS_PATH}?status=PUBLISH_APPROVED`} className="group block">
          <Card className="h-full transition-colors hover:border-foreground/20 hover:bg-muted/50 dark:hover:bg-white/[0.03]">
            <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
              <PenSquare className="h-4 w-4 text-emerald-500" />
              <CardTitle className="text-sm font-medium">포스트 — 발행 승인</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">
                {postCount['PUBLISH_APPROVED'] ?? 0}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">발행 대기 포스트</p>
            </CardContent>
          </Card>
        </Link>

        {/* 포스트 — 발행됨 */}
        <Link href={`${BLOG_OPS_POSTS_PATH}?status=PUBLISHED`} className="group block">
          <Card className="h-full transition-colors hover:border-foreground/20 hover:bg-muted/50 dark:hover:bg-white/[0.03]">
            <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
              <PenSquare className="h-4 w-4 text-emerald-600" />
              <CardTitle className="text-sm font-medium">포스트 — 발행됨</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{postCount['PUBLISHED'] ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">발행 완료 포스트</p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  )
}
