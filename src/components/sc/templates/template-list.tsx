import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SALES_CONTENT_TEMPLATES_PATH } from '@/lib/deck-routes'

type TemplateRow = {
  id: string
  name: string
  slug: string
  kind: 'BLOG' | 'SOCIAL' | 'CARDNEWS'
  isSystem: boolean
  isActive: boolean
  updatedAt: Date
}

const KIND_LABEL: Record<TemplateRow['kind'], string> = {
  BLOG: '블로그 장문',
  SOCIAL: '소셜 텍스트',
  CARDNEWS: '카드뉴스',
}

type Props = { templates: TemplateRow[] }

export function TemplateList({ templates }: Props) {
  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm text-muted-foreground">사용 가능한 템플릿이 없습니다.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {templates.map((t) => (
        <Link
          key={t.id}
          href={`${SALES_CONTENT_TEMPLATES_PATH}/${t.id}`}
          className="block rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:bg-accent"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold">{t.name}</h3>
                {t.isSystem && (
                  <Badge variant="outline" className="text-xs">
                    시스템
                  </Badge>
                )}
                {!t.isActive && (
                  <Badge variant="outline" className="text-xs">
                    비활성
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {KIND_LABEL[t.kind]} · <span className="font-mono">/{t.slug}</span>
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Intl.DateTimeFormat('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              }).format(t.updatedAt)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}
