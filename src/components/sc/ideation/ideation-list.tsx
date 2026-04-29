import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SALES_CONTENT_IDEATION_PATH } from '@/lib/deck-routes'

type IdeationRow = {
  id: string
  userPromptInput: string | null
  generatedBy: 'USER' | 'AI'
  providerName: string | null
  createdAt: Date
  product: { id: string; name: string; slug: string } | null
  persona: { id: string; name: string; slug: string } | null
  ideaCount: number
  firstTitle: string | null
}

type Props = {
  ideations: IdeationRow[]
}

export function IdeationList({ ideations }: Props) {
  if (ideations.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            아직 실행한 아이데이션이 없습니다. 위 폼에서 첫 글감을 생성해 보세요.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {ideations.map((it) => (
        <Link
          key={it.id}
          href={`${SALES_CONTENT_IDEATION_PATH}/${it.id}`}
          className="block rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:bg-accent"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge
                  variant={it.generatedBy === 'AI' ? 'default' : 'outline'}
                  className="text-xs"
                >
                  {it.generatedBy === 'AI' ? 'AI 생성' : '사용자 작성'}
                </Badge>
                {it.providerName && (
                  <span className="text-xs text-muted-foreground">{it.providerName}</span>
                )}
                <span className="text-xs text-muted-foreground">· {it.ideaCount}개</span>
              </div>
              {it.firstTitle && (
                <h3 className="mt-1.5 truncate text-sm font-semibold">{it.firstTitle}</h3>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {[it.product?.name, it.persona?.name].filter(Boolean).join(' · ') || '맥락 없음'}
              </p>
              {it.userPromptInput && (
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                  “{it.userPromptInput}”
                </p>
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Intl.DateTimeFormat('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              }).format(it.createdAt)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}
