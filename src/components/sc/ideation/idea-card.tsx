import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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
}

export function IdeaCard({ idea, index }: Props) {
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
      </CardContent>
    </Card>
  )
}
