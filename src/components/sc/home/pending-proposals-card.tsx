import Link from 'next/link'
import { Bot, ArrowRight } from 'lucide-react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { APPROVALS_PATH } from '@/lib/deck-routes'

/** 에이전트가 올린 게시물 제안 중 승인 대기 건. 없으면 그리지 않는다. */
export async function PendingProposalsCard() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return null
  const spaceId = resolved.space.id
  const pending = await prisma.agentPendingAction.count({
    where: { spaceId, deckKey: 'sales-content', status: 'PENDING', expiresAt: { gt: new Date() } },
  })
  if (pending === 0) return null

  return (
    <Link href={`${APPROVALS_PATH}?spaceId=${spaceId}`} className="block">
      <Card className="border-fuchsia-500/40 transition-colors hover:bg-muted/40">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div className="flex items-center gap-3">
            <Bot className="h-5 w-5 text-fuchsia-500" />
            <div>
              <CardTitle className="text-base">에이전트 게시물 제안 {pending}건</CardTitle>
              <CardDescription>
                승인하면 콘텐츠가 만들어지고 해당 채널로 발행이 예약됩니다.
              </CardDescription>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </CardHeader>
      </Card>
    </Link>
  )
}
