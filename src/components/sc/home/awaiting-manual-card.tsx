import Link from 'next/link'
import { ArrowRight, Send } from 'lucide-react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { SALES_CONTENT_CONTENTS_PATH } from '@/lib/deck-routes'

/** 승인됐지만 사람이 아직 플랫폼에 올리지 않은 배포. 없으면 그리지 않는다. */
export async function AwaitingManualCard() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return null
  const where = { spaceId: resolved.space.id, status: 'AWAITING_MANUAL' as const }
  const [count, oldest] = await Promise.all([
    prisma.contentDeployment.count({ where }),
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
              <CardTitle className="text-base">게시 대기 {count}건</CardTitle>
              <CardDescription>본문을 복사해 게시한 뒤 글 주소를 등록해 주세요.</CardDescription>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </CardHeader>
      </Card>
    </Link>
  )
}
