'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SALES_CONTENT_CONTENTS_PATH } from '@/lib/deck-routes'

export type IdeaCardData = {
  title: string
  hook: string
  angle: string
  keyPoints: string[]
  targetChannel: 'blog' | 'social' | 'cardnews'
  reasoning: string
}

const CHANNEL_LABEL: Record<IdeaCardData['targetChannel'], string> = {
  blog: '블로그 장문',
  social: '소셜 텍스트',
  cardnews: '카드뉴스',
}

type Props = {
  idea: IdeaCardData
  index: number
  // 아이데이션 세션 ID — "콘텐츠로 보내기" 시 ideationId 로 전달
  ideationId: string
}

export function IdeaCard({ idea, index, ideationId }: Props) {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 아이데이션 → 콘텐츠 생성 (status=TODO)
  async function handleSendToContents() {
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/sc/contents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: idea.title,
          status: 'TODO',
          ideationId,
          ideaIndex: index,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message ?? '콘텐츠 생성에 실패했습니다')
      }
      // 성공 → 콘텐츠 관리(Kanban)로 이동 — TO-DO 컬럼에 표시됨
      router.push(SALES_CONTENT_CONTENTS_PATH)
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다')
      setSending(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">#{index + 1}</p>
            <h3 className="mt-1 text-sm font-semibold">{idea.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{idea.hook}</p>
          </div>
          <Badge variant="outline" className="shrink-0 text-xs">
            {CHANNEL_LABEL[idea.targetChannel]}
          </Badge>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">관점</p>
          <p className="mt-0.5 text-sm">{idea.angle}</p>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">핵심 메시지</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
            {idea.keyPoints.map((kp, i) => (
              <li key={i}>{kp}</li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">적합 이유</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{idea.reasoning}</p>
        </div>

        {/* 아이데이션 → 콘텐츠 전송 액션 */}
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              disabled={sending}
              onClick={handleSendToContents}
              className="gap-1.5"
            >
              <Send className="h-3.5 w-3.5" />
              {sending ? '전송 중...' : '콘텐츠로 보내기'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
