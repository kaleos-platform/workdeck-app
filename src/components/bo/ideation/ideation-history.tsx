'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'

type Material = { id: string; status: string }

type Ideation = {
  id: string
  userPromptInput: string | null
  appealPoints: unknown
  providerName: string | null
  providerModel: string | null
  latencyMs: number | null
  createdAt: string
  product: { id: string; name: string }
  materials: Material[]
}

interface IdeationHistoryProps {
  // refreshKey가 바뀌면 목록을 다시 불러옴
  refreshKey: number
}

export function IdeationHistory({ refreshKey }: IdeationHistoryProps) {
  const [ideations, setIdeations] = useState<Ideation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/bo/ideations')
      if (!res.ok) throw new Error('목록을 불러오지 못했습니다')
      const data = (await res.json()) as { ideations: Ideation[] }
      setIdeations(data.ideations)
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류 발생')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        목록 로딩 중...
      </div>
    )
  }

  if (error) {
    return <p className="py-4 text-sm text-destructive">{error}</p>
  }

  if (ideations.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        아직 실행 이력이 없습니다. 위에서 소구점 발굴을 실행해 보세요.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {ideations.map((item) => {
        const appealPointsArr = Array.isArray(item.appealPoints) ? item.appealPoints : []
        const proposedCount = item.materials.filter((m) => m.status === 'PROPOSED').length
        const approvedCount = item.materials.filter((m) => m.status === 'APPROVED').length

        return (
          <Card key={item.id} className="text-sm">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <span>{item.product.name}</span>
                {item.providerName && (
                  <Badge variant="outline" className="text-xs font-normal">
                    {item.providerName}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4 pb-4">
              {item.userPromptInput && (
                <p className="line-clamp-2 text-muted-foreground">{item.userPromptInput}</p>
              )}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>소구점 {appealPointsArr.length}개</span>
                <span>소재 {item.materials.length}개</span>
                {approvedCount > 0 && (
                  <span className="text-emerald-600">승인됨 {approvedCount}개</span>
                )}
                {proposedCount > 0 && (
                  <span className="text-amber-600">검토 대기 {proposedCount}개</span>
                )}
                {item.latencyMs != null && <span>{(item.latencyMs / 1000).toFixed(1)}s</span>}
                <span>{new Date(item.createdAt).toLocaleString('ko-KR')}</span>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
