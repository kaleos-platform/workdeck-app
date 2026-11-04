import Link from 'next/link'
import { ArrowRight, Send } from 'lucide-react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { SALES_CONTENT_CONTENTS_PATH } from '@/lib/deck-routes'

/** 승인됐지만 사람 손이 필요한 배포(사진 등록·플랫폼 게시). 없으면 그리지 않는다. */
export async function AwaitingManualCard() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return null
  const where = {
    spaceId: resolved.space.id,
    status: { in: ['AWAITING_ASSETS' as const, 'AWAITING_MANUAL' as const] },
  }
  const [assets, manual, oldest] = await Promise.all([
    prisma.contentDeployment.count({ where: { ...where, status: 'AWAITING_ASSETS' } }),
    prisma.contentDeployment.count({ where: { ...where, status: 'AWAITING_MANUAL' } }),
    prisma.contentDeployment.findFirst({
      where,
      orderBy: { createdAt: 'asc' },
      select: { contentId: true },
    }),
  ])
  if (!oldest) return null

  return (
    <Link href={`${SALES_CONTENT_CONTENTS_PATH}/${oldest.contentId}`} className="block">
      <Card className="border-amber-500/40 transition-colors hover:bg-muted/40">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div className="flex items-center gap-3">
            <Send className="h-5 w-5 text-amber-500" />
            <div>
              <CardTitle className="text-base">
                {[assets > 0 && `사진 대기 ${assets}건`, manual > 0 && `게시 대기 ${manual}건`]
                  .filter(Boolean)
                  .join(' · ')}
              </CardTitle>
              <CardDescription>
                {assets > 0
                  ? '사진을 등록하면 자동으로 게시합니다.'
                  : '본문을 복사해 게시한 뒤 글 주소를 등록해 주세요.'}
              </CardDescription>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </CardHeader>
      </Card>
    </Link>
  )
}
