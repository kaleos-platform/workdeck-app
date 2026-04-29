import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SALES_CONTENT_PERSONAS_PATH } from '@/lib/deck-routes'

type PersonaRow = {
  id: string
  name: string
  slug: string
  jobTitle: string | null
  industry: string | null
  companySize: string | null
  isActive: boolean
  updatedAt: Date
}

export function PersonaList({ personas }: { personas: PersonaRow[] }) {
  if (personas.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            아직 등록된 페르소나가 없습니다. 타겟 고객의 프로파일을 먼저 정의하세요.
          </p>
          <Button asChild className="mt-4">
            <Link href={`${SALES_CONTENT_PERSONAS_PATH}/new`}>페르소나 추가</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {personas.map((p) => (
        <Link
          key={p.id}
          href={`${SALES_CONTENT_PERSONAS_PATH}/${p.id}`}
          className="block rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:bg-accent"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold">{p.name}</h3>
                {!p.isActive && (
                  <Badge variant="outline" className="text-xs">
                    비활성
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">/{p.slug}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {[p.jobTitle, p.industry, p.companySize].filter(Boolean).join(' · ') ||
                  '세부 정보 미입력'}
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Intl.DateTimeFormat('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              }).format(p.updatedAt)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}
