import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { ContentStatusBadge } from './content-status-badge'
import { SALES_CONTENT_CONTENTS_PATH } from '@/lib/deck-routes'

type ContentRow = {
  id: string
  title: string
  status: 'TODO' | 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHED' | 'ANALYZED'
  updatedAt: Date
  channel: { id: string; name: string; platform: string } | null
}

type Props = { contents: ContentRow[] }

export function ContentList({ contents }: Props) {
  if (contents.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            아직 제작된 콘텐츠가 없습니다. 새 콘텐츠로 시작하세요.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {contents.map((c) => (
        <Link
          key={c.id}
          href={`${SALES_CONTENT_CONTENTS_PATH}/${c.id}`}
          className="block rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:bg-accent"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <ContentStatusBadge status={c.status} />
                {c.channel && (
                  <span className="text-xs text-muted-foreground">
                    → {c.channel.name} ({c.channel.platform})
                  </span>
                )}
              </div>
              <h3 className="mt-1.5 truncate text-sm font-semibold">{c.title}</h3>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Intl.DateTimeFormat('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              }).format(c.updatedAt)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}
