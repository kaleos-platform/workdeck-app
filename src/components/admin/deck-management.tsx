import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { DECK_META, type DeckVariant } from '@/lib/deck-meta'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

type ManagedDeck = Exclude<DeckVariant, 'workdeck'>
type Tool = { name: string; href: string; description: string }

// 덱별 운영 기능만 등록한다. 사용자·구독·결제는 공통 메뉴에서 관리한다.
const TOOLS: Partial<Record<ManagedDeck, readonly Tool[]>> = {
  recruiting: [
    {
      name: '샘플 템플릿',
      href: '/admin/templates',
      description: '전체 공간에 제공하는 모집 샘플 템플릿을 생성·편집합니다.',
    },
    {
      name: '첨부 정리 이력',
      href: '/admin/hiring-upload-sweep',
      description: '모집 첨부파일 정리 작업의 실행 결과를 확인합니다.',
    },
  ],
}

const deckIds = (Object.keys(DECK_META) as DeckVariant[])
  .filter((id): id is ManagedDeck => id !== 'workdeck')
  .sort((a, b) => DECK_META[a].name.localeCompare(DECK_META[b].name, 'ko'))

export function DeckManagement() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {deckIds.map((id) => {
        const deck = DECK_META[id]
        const Icon = deck.icon
        const tools = TOOLS[id] ?? []
        return (
          <section key={id} aria-label={`${deck.name} 운영 기능`}>
            <Card className="h-full gap-3 py-4">
              <CardHeader className="px-4">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <h2 className="text-sm font-medium">{deck.name}</h2>
                  {tools.length > 0 && (
                    <Badge variant="secondary" className="ml-auto">
                      {tools.length}개 기능
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-4">
                {tools.length > 0 ? (
                  <ul className="divide-y">
                    {tools.map((tool) => (
                      <li key={tool.href}>
                        <Link
                          href={tool.href}
                          className="group flex min-h-11 items-center gap-3 rounded-md px-2 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <span className="block text-sm font-medium group-hover:underline">
                              {tool.name}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {tool.description}
                            </span>
                          </div>
                          <ChevronRight
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-3 text-sm text-muted-foreground">관리 기능 없음</p>
                )}
              </CardContent>
            </Card>
          </section>
        )
      })}
    </div>
  )
}
