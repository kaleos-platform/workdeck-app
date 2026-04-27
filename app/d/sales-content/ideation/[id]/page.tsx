import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { IdeaCard, type IdeaCardData } from '@/components/sc/ideation/idea-card'
import { SALES_CONTENT_IDEATION_PATH } from '@/lib/deck-routes'

type Props = {
  params: Promise<{ id: string }>
}

export default async function IdeationDetailPage({ params }: Props) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const { id } = await params
  const ideation = await prisma.contentIdea.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: {
      product: { select: { id: true, name: true, slug: true } },
      persona: { select: { id: true, name: true, slug: true } },
    },
  })
  if (!ideation) notFound()

  const ideas = (Array.isArray(ideation.ideas) ? ideation.ideas : []) as IdeaCardData[]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant={ideation.generatedBy === 'AI' ? 'default' : 'outline'}>
              {ideation.generatedBy === 'AI' ? 'AI 생성' : '사용자 작성'}
            </Badge>
            {ideation.providerName && (
              <span className="text-xs text-muted-foreground">{ideation.providerName}</span>
            )}
            {ideation.latencyMs != null && (
              <span className="text-xs text-muted-foreground">
                · {Math.round(ideation.latencyMs)}ms
              </span>
            )}
          </div>
          <h1 className="mt-2 text-xl font-bold tracking-tight">
            아이데이션 결과 — {ideas.length}개
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[ideation.product?.name, ideation.persona?.name].filter(Boolean).join(' · ') ||
              '맥락 없음'}
          </p>
        </div>
        <Button asChild variant="ghost">
          <Link href={SALES_CONTENT_IDEATION_PATH}>← 목록</Link>
        </Button>
      </div>

      {ideation.userPromptInput && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">사용자 지시</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {ideation.userPromptInput}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {ideas.map((idea, i) => (
          <IdeaCard key={i} idea={idea} index={i} />
        ))}
      </div>

      <p className="pt-4 text-xs text-muted-foreground">
        prompt trace: <span className="font-mono">{ideation.promptTraceHash ?? 'n/a'}</span>
      </p>
    </div>
  )
}
