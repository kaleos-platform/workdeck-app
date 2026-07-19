'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { PricingSimSnapshot } from '@/lib/sh/pricing-scenario-snapshot'
import { type ScenarioRow, priceRangeText } from './pricing-scenario-format'

type Props = {
  /** 이 상품(InvProduct.id)이 포함된 시나리오만 조회 */
  productId: string
  /** 있으면 [불러오기] 노출 — 시뮬 화면에서 상태로 복원. 없으면 읽기전용(상품 상세). */
  onLoad?: (snapshot: PricingSimSnapshot) => void
  /** true면 삭제 버튼 노출 (시뮬 화면 관리용). 상품 상세는 조회 전용이라 미노출. */
  allowDelete?: boolean
  /** 있으면 행 클릭 시 호출(예: 시나리오 상세로 이동). load·delete 버튼은 전파 차단. */
  onRowClick?: (id: string) => void
  /** 값이 바뀌면 목록 재조회 (저장 직후 갱신용) */
  refreshSignal?: number
}

export function PricingScenarioHistoryPanel({
  productId,
  onLoad,
  allowDelete,
  onRowClick,
  refreshSignal,
}: Props) {
  const [rows, setRows] = useState<ScenarioRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/sh/pricing-scenarios?productId=${encodeURIComponent(productId)}&pageSize=100`
      )
      if (!res.ok) throw new Error('조회 실패')
      const data: { data: ScenarioRow[] } = await res.json()
      setRows(data.data ?? [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    load()
  }, [load, refreshSignal])

  const handleLoad = useCallback(
    async (id: string) => {
      if (!onLoad) return
      setLoadingId(id)
      try {
        const res = await fetch(`/api/sh/pricing-scenarios/${id}`)
        if (!res.ok) throw new Error('불러오기 실패')
        const data: { snapshot: PricingSimSnapshot | null } = await res.json()
        if (!data.snapshot) throw new Error('시나리오 데이터가 손상되었습니다')
        onLoad(data.snapshot)
        toast.success('시나리오를 불러왔습니다')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '불러오기 실패')
      } finally {
        setLoadingId(null)
      }
    },
    [onLoad]
  )

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`시나리오 "${name}"을(를) 삭제하시겠습니까?`)) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/sh/pricing-scenarios/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제 실패')
      toast.success('시나리오를 삭제했습니다')
      setRows((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    } finally {
      setDeletingId(null)
    }
  }, [])

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-10 text-center">
        <p className="text-sm text-muted-foreground">저장된 가격 시나리오가 없습니다</p>
        {onLoad && (
          <p className="mt-1 text-xs text-muted-foreground">
            시뮬레이션을 구성한 뒤 상단 [시나리오 저장]으로 저장하세요
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이름</TableHead>
            <TableHead className="text-right">목표 마진</TableHead>
            <TableHead className="text-right">채널</TableHead>
            <TableHead className="text-right">권장가</TableHead>
            <TableHead>수정일</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.id}
              className={cn('hover:bg-muted/40', onRowClick && 'cursor-pointer')}
              onClick={onRowClick ? () => onRowClick(r.id) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onRowClick(r.id)
                      }
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? 'button' : undefined}
              aria-label={onRowClick ? `${r.name} 상세` : undefined}
            >
              <TableCell>
                <div className="text-sm font-medium">{r.name}</div>
                {r.memo && <div className="text-xs text-muted-foreground">{r.memo}</div>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.summary ? `${r.summary.targetMarginPct}%` : '—'}
              </TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {r.summary ? `${r.summary.channelCount}개` : '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums">{priceRangeText(r.summary)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(r.updatedAt).toLocaleDateString('ko-KR')}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  {onLoad && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleLoad(r.id)
                      }}
                      disabled={loadingId === r.id}
                      aria-label={`${r.name} 불러오기`}
                    >
                      {loadingId === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      불러오기
                    </Button>
                  )}
                  {allowDelete && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(r.id, r.name)
                      }}
                      disabled={deletingId === r.id}
                      aria-label={`${r.name} 삭제`}
                      className="inline-flex text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      {deletingId === r.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
