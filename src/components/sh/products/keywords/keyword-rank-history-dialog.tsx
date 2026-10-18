'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { formatDateToYmdKst } from '@/lib/date-range'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  formatRankNumber,
  OUT_OF_TOP100_RANK,
  sourceLongLabel,
  type RankSource,
  type RankStatus,
} from './rank-format'

type Point = { date: string; source: RankSource; status: RankStatus; rank: number | null }
type Change = {
  id: string
  createdAt: string
  beforeName: string | null
  afterName: string | null
  beforeKeywords: string[]
  afterKeywords: string[]
}

type Props = {
  targetKey: string
  keyword: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const SOURCE_COLOR: Record<RankSource, string> = {
  NAVER_SHOPPING: '#03c75a',
  COUPANG: '#e4002b',
}

/** 차트 y 값 — 순위권 밖은 101, 측정 실패·미측정은 null(선을 끊는다). */
function plotValue(p: Point): number | null {
  if (p.status === 'RANKED') return p.rank
  if (p.status === 'NOT_IN_TOP100') return OUT_OF_TOP100_RANK
  return null
}

export function KeywordRankHistoryDialog({ targetKey, keyword, open, onOpenChange }: Props) {
  const [points, setPoints] = useState<Point[] | null>(null)
  const [changes, setChanges] = useState<Change[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPoints(null)
    setError(null)
    void (async () => {
      try {
        const params = new URLSearchParams({ targetKey, keyword, days: '90' })
        const res = await fetch(`/api/sh/keyword-ranks/history?${params.toString()}`, {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error('순위 이력을 불러오지 못했습니다')
        const data: { points: Point[]; changes: Change[] } = await res.json()
        if (cancelled) return
        setPoints(data.points ?? [])
        setChanges(data.changes ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '순위 이력을 불러오지 못했습니다')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, targetKey, keyword])

  const sources = useMemo(() => Array.from(new Set((points ?? []).map((p) => p.source))), [points])

  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, string | number | null>>()
    for (const p of points ?? []) {
      const row = byDate.get(p.date) ?? { date: p.date }
      row[p.source] = plotValue(p)
      byDate.set(p.date, row)
    }
    return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)))
  }, [points])

  const changeDates = useMemo(
    // 순위 날짜가 KST 하루 단위라 변경 시점도 KST 날짜로 맞춘다(UTC 로 자르면 새벽 변경이 하루 앞에 찍힌다).
    () => new Set(changes.map((c) => formatDateToYmdKst(new Date(c.createdAt)))),
    [changes]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{keyword}</DialogTitle>
          <DialogDescription>최근 90일 검색 순위 (1위가 위쪽)</DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="py-6 text-center text-sm text-destructive">{error}</p>
        ) : !points ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            불러오는 중...
          </p>
        ) : chartData.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            아직 기록된 순위가 없습니다.
          </p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis
                  reversed
                  domain={[1, OUT_OF_TOP100_RANK]}
                  tick={{ fontSize: 11 }}
                  width={60}
                  tickFormatter={(v: number) => (v >= OUT_OF_TOP100_RANK ? '100위 밖' : `${v}`)}
                />
                <Tooltip
                  formatter={(v, name) => [
                    formatRankNumber(typeof v === 'number' ? v : null),
                    sourceLongLabel(name as RankSource),
                  ]}
                />
                {sources.map((s) => (
                  <Line
                    key={s}
                    dataKey={s}
                    stroke={SOURCE_COLOR[s]}
                    dot={{ r: 2 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
                {chartData
                  .filter((r) => changeDates.has(String(r.date)))
                  .map((r) => (
                    <ReferenceLine
                      key={String(r.date)}
                      x={String(r.date)}
                      stroke="#f59e0b"
                      strokeDasharray="4 2"
                    />
                  ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {changes.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium">상품명·검색어 변경</p>
            <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
              {changes.map((c) => {
                const before = new Set(c.beforeKeywords)
                const after = new Set(c.afterKeywords)
                const added = c.afterKeywords.filter((k) => !before.has(k))
                const removed = c.beforeKeywords.filter((k) => !after.has(k))
                const nameChanged = (c.beforeName ?? '').trim() !== (c.afterName ?? '').trim()
                return (
                  <li key={c.id}>
                    <span className="tabular-nums">
                      {formatDateToYmdKst(new Date(c.createdAt))}
                    </span>
                    {nameChanged && ' · 상품명 변경'}
                    {added.length > 0 && ` · +${added.join(', +')}`}
                    {removed.length > 0 && ` · −${removed.join(', −')}`}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
