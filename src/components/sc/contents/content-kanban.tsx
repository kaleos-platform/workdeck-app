'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SALES_CONTENT_CONTENTS_PATH, SALES_CONTENT_SETTINGS_PATH } from '@/lib/deck-routes'
import { nextAllowed } from '@/lib/sc/content-state'
import type { ContentStatus } from '@/generated/prisma/client'

// 각 상태로 전환할 때 표시할 액션 레이블
const TRANSITION_LABEL: Partial<Record<ContentStatus, string>> = {
  DRAFT: '작성 시작',
  IN_REVIEW: '리뷰 요청',
  APPROVED: '승인',
  SCHEDULED: '예약',
  PUBLISHED: '발행',
  ANALYZED: '분석 완료',
}

// 배포 컬럼 내 세부 상태 배지
const DEPLOY_BADGE_LABEL: Partial<Record<ContentStatus, string>> = {
  APPROVED: '발행 대기',
  SCHEDULED: '예약됨',
  PUBLISHED: '발행됨',
}

// 5개 컬럼 정의 — statuses 목록에 포함된 카드가 해당 컬럼에 표시됨
type ColumnDef = {
  key: string
  emoji: string
  label: string
  statuses: ContentStatus[]
  placeholder: string
}

const COLUMNS: ColumnDef[] = [
  {
    key: 'todo',
    emoji: '📌',
    label: 'TO-DO',
    statuses: ['TODO'],
    placeholder: '아이데이션에서 토픽을 보내주세요',
  },
  {
    key: 'draft',
    emoji: '📝',
    label: '작성',
    statuses: ['DRAFT'],
    placeholder: '작성 중인 콘텐츠가 없습니다',
  },
  {
    key: 'review',
    emoji: '👀',
    label: '리뷰',
    statuses: ['IN_REVIEW'],
    placeholder: '리뷰 대기 중인 콘텐츠가 없습니다',
  },
  {
    key: 'deploy',
    emoji: '🚀',
    label: '배포',
    statuses: ['APPROVED', 'SCHEDULED', 'PUBLISHED'],
    placeholder: '배포 준비된 콘텐츠가 없습니다',
  },
  {
    key: 'analyzed',
    emoji: '📊',
    label: '분석',
    statuses: ['ANALYZED'],
    placeholder: '분석 완료된 콘텐츠가 없습니다',
  },
]

export type KanbanContentRow = {
  id: string
  title: string
  status: ContentStatus
  updatedAt: Date
  channel: { id: string; name: string; platform: string } | null
}

type Props = { contents: KanbanContentRow[] }

// 상태 전환 API 호출
async function callTransition(contentId: string, to: ContentStatus): Promise<void> {
  const res = await fetch(`/api/sc/contents/${contentId}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to }),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(data.message ?? '상태 전환에 실패했습니다')
  }
}

// 카드 단일 컴포넌트
function KanbanCard({
  card,
  showDeployBadge,
  onTransition,
}: {
  card: KanbanContentRow
  showDeployBadge: boolean
  onTransition: (to: ContentStatus) => Promise<void>
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const allowed = nextAllowed(card.status)

  async function handleTransition(to: ContentStatus) {
    setLoading(true)
    setError(null)
    try {
      await onTransition(to)
    } catch (err) {
      setError(err instanceof Error ? err.message : '상태 전환에 실패했습니다')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card
      className="cursor-pointer transition hover:border-primary/40 hover:bg-accent"
      onClick={() => router.push(`${SALES_CONTENT_CONTENTS_PATH}/${card.id}`)}
    >
      <CardContent className="p-3">
        {/* 상단: 배포 컬럼 세부 배지 */}
        {showDeployBadge && DEPLOY_BADGE_LABEL[card.status] && (
          <div className="mb-1.5">
            <Badge variant="outline" className="text-xs">
              {DEPLOY_BADGE_LABEL[card.status]}
            </Badge>
          </div>
        )}

        {/* 제목 */}
        <p className="truncate text-sm leading-snug font-semibold">{card.title}</p>

        {/* 메타: 채널 + 시각 + 메뉴 */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {card.channel && (
              <Badge variant="secondary" className="max-w-[120px] truncate text-xs">
                {card.channel.name}
              </Badge>
            )}
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Intl.DateTimeFormat('ko-KR', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              }).format(card.updatedAt)}
            </span>
          </div>

          {/* 상태 전환 메뉴 — 유효한 전이만 표시 */}
          {allowed.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" disabled={loading}>
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  <span className="sr-only">상태 전환</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {allowed.map((to) => (
                  <DropdownMenuItem
                    key={to}
                    onSelect={() => handleTransition(to)}
                    disabled={loading}
                  >
                    {TRANSITION_LABEL[to] ?? to}
                  </DropdownMenuItem>
                ))}
                {/* 개선 규칙 보기 */}
                <DropdownMenuItem
                  onSelect={() => router.push(`${SALES_CONTENT_SETTINGS_PATH}?tab=rules`)}
                >
                  개선 규칙 보기
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* 상태 전환 실패 메시지 */}
        {error && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function ContentKanban({ contents }: Props) {
  const router = useRouter()

  // 상태 전환 후 라우터 새로고침으로 서버 데이터 재요청
  async function handleTransition(contentId: string, to: ContentStatus) {
    await callTransition(contentId, to)
    router.refresh()
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {COLUMNS.map((col) => {
        // 해당 컬럼의 statuses 에 속하는 카드 필터
        const cards = contents.filter((c) => col.statuses.includes(c.status))
        const isDeployCol = col.key === 'deploy'

        return (
          <div key={col.key} className="flex w-64 shrink-0 flex-col gap-2">
            {/* 컬럼 헤더 */}
            <div className="flex items-center gap-1.5 px-1">
              <span className="text-sm">{col.emoji}</span>
              <span className="text-sm font-semibold">{col.label}</span>
              <span className="ml-auto text-xs text-muted-foreground">{cards.length}</span>
            </div>

            {/* 카드 목록 */}
            <div className="flex flex-col gap-2">
              {cards.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-center">
                  <p className="text-xs text-muted-foreground">{col.placeholder}</p>
                </div>
              ) : (
                cards.map((card) => (
                  <KanbanCard
                    key={card.id}
                    card={card}
                    showDeployBadge={isDeployCol}
                    onTransition={(to) => handleTransition(card.id, to)}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
