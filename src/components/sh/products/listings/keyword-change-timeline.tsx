'use client'

// 상품명·검색어 변경 이력 타임라인 — 가이드 §26.
//
// append-only 라 편집·삭제 UI 를 두지 않는다. 최신순으로만 읽는다.

import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, Split } from 'lucide-react'

import type { KeywordChangeReason } from '@/generated/prisma/enums'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { KEYWORD_CHANGE_REASON_LABELS } from '@/lib/sh/keyword-labels'
import { cn } from '@/lib/utils'
import { formatRankNumber, sourceLongLabel, type RankSource } from '../keywords/rank-format'

type ChangeLog = {
  id: string
  beforeName: string | null
  afterName: string | null
  beforeKeywords: string[]
  afterKeywords: string[]
  /** 사유 입력 폐지(2026-10) 이전 기록만 값이 있다. */
  reason: KeywordChangeReason | null
  reasonNote: string | null
  observeMetric: string | null
  multiChange: boolean
  createdAt: string
}

type Props = {
  /** 조회 대상 — 주어진 조건들을 OR 로 묶는다. */
  /** 리스팅 단위 이력. listing PATCH 가 남긴 기록이 여기로 묶인다. */
  listingId?: string | null
  /** 채널상품(그룹) 단위 이력. 그룹 소속 리스팅의 기록도 함께 묶인다. */
  channelProductId?: string | null
  /** 상품 단위 이력 — channelProductId 도입 전 채널상품 기록은 이것으로만 찾힌다. */
  productId?: string | null
  /** 저장 후 목록을 다시 불러오기 위한 신호. 값이 바뀔 때마다 재조회한다. */
  refreshKey?: number
  /** 상품 단위 조회는 채널을 가리지 않으므로 그 사실을 함께 알린다. */
  crossChannelNotice?: boolean
}

const PAGE_SIZE = 20

export function KeywordChangeTimeline({
  listingId,
  channelProductId,
  productId,
  refreshKey = 0,
  crossChannelNotice = false,
}: Props) {
  const [rows, setRows] = useState<ChangeLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabled = !listingId && !channelProductId && !productId

  const load = useCallback(
    async (targetPage: number) => {
      if (disabled) return
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (listingId) params.set('listingId', listingId)
        if (channelProductId) params.set('channelProductId', channelProductId)
        if (productId) params.set('productId', productId)
        params.set('page', String(targetPage))
        params.set('pageSize', String(PAGE_SIZE))
        const res = await fetch(`/api/sh/keywords/changes?${params.toString()}`, {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error('변경 이력을 불러오지 못했습니다')
        const data: { data: ChangeLog[]; total: number } = await res.json()
        setRows(data.data ?? [])
        setTotal(data.total ?? 0)
        setPage(targetPage)
      } catch (e) {
        setError(e instanceof Error ? e.message : '변경 이력을 불러오지 못했습니다')
      } finally {
        setLoading(false)
      }
    },
    [disabled, listingId, channelProductId, productId]
  )

  // refreshKey 가 바뀌면 항상 1페이지부터 다시 읽는다 — 새 기록은 최신순 맨 앞에 붙는다.
  useEffect(() => {
    void load(1)
  }, [load, refreshKey])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-4 w-4" aria-hidden="true" />
          변경 이력
        </CardTitle>
        <CardDescription>
          상품명·검색어를 언제 바꿨는지 저장할 때 자동으로 남는 기록입니다. 수정·삭제할 수 없습니다.
          {crossChannelNotice && ' 이 상품의 다른 채널 기록도 함께 표시됩니다.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-4 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load(page)}>
              다시 시도
            </Button>
          </div>
        ) : loading && rows.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            불러오는 중...
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            아직 변경 이력이 없습니다.
          </p>
        ) : (
          <>
            <ol className="space-y-3">
              {rows.map((row) => (
                <TimelineRow key={row.id} row={row} />
              ))}
            </ol>
            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm">
                <span className="text-muted-foreground">
                  {page} / {totalPages} 페이지 · 총 {total}건
                </span>
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void load(page - 1)}
                    disabled={page <= 1 || loading}
                  >
                    이전
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void load(page + 1)}
                    disabled={page >= totalPages || loading}
                  >
                    다음
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TimelineRow({ row }: { row: ChangeLog }) {
  const [effectOpen, setEffectOpen] = useState(false)
  const beforeSet = new Set(row.beforeKeywords)
  const afterSet = new Set(row.afterKeywords)
  const added = row.afterKeywords.filter((k) => !beforeSet.has(k))
  const removed = row.beforeKeywords.filter((k) => !afterSet.has(k))
  const nameChanged = (row.beforeName ?? '').trim() !== (row.afterName ?? '').trim()

  return (
    <li className="rounded-md border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <time
          dateTime={row.createdAt}
          className="text-xs text-muted-foreground tabular-nums"
          suppressHydrationWarning
        >
          {formatDateTime(row.createdAt)}
        </time>
        {row.reason && (
          <Badge variant="secondary">{KEYWORD_CHANGE_REASON_LABELS[row.reason]}</Badge>
        )}
        {row.multiChange && (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400"
          >
            <Split className="h-3 w-3" aria-hidden="true" />
            동시 변경
          </Badge>
        )}
      </div>

      {nameChanged && (
        <div className="mt-2 space-y-0.5 text-sm">
          <p className="break-words text-muted-foreground line-through">
            {row.beforeName?.trim() || '(비어 있음)'}
          </p>
          <p className="font-medium break-words">{row.afterName?.trim() || '(비어 있음)'}</p>
        </div>
      )}

      {(added.length > 0 || removed.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {added.map((k) => (
            <Chip key={`a-${k}`} tone="added">
              +{k}
            </Chip>
          ))}
          {removed.map((k) => (
            <Chip key={`r-${k}`} tone="removed">
              −{k}
            </Chip>
          ))}
        </div>
      )}

      {row.reasonNote && <p className="mt-2 text-sm">{row.reasonNote}</p>}

      {row.observeMetric && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          관찰 지표: <span className="text-foreground">{row.observeMetric}</span>
        </p>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-1.5 h-7 px-2 text-xs"
        aria-expanded={effectOpen}
        onClick={() => setEffectOpen((v) => !v)}
      >
        효과 보기
      </Button>
      {effectOpen && <EffectPanel logId={row.id} />}
    </li>
  )
}

type Effect =
  | { unavailable: string }
  | {
      label: string
      before: { from: string; to: string; quantity: number; revenue: number }
      after: {
        from: string
        to: string
        quantity: number
        revenue: number
        observedDays: number
        complete: boolean
      }
      ranks: Array<{
        keyword: string
        source: RankSource
        before: number | null
        after: number | null
      }>
    }

const OBSERVE_DAYS = 14

/** 변화율 %. 비교 기준이 0 이하면 null(표시 시 "-"). sales-analytics 의 pctChange 와 같은 의미. */
function pct(current: number, prev: number): string {
  if (prev <= 0) return '-'
  const v = Math.round(((current - prev) / prev) * 1000) / 10
  return `${v > 0 ? '+' : ''}${v}%`
}

/** 펼칠 때 한 번만 조회한다 — 행마다 미리 부르면 이력 페이지 로드가 N+1 이 된다. */
function EffectPanel({ logId }: { logId: string }) {
  const [effect, setEffect] = useState<Effect | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/sh/keywords/changes/${logId}/effect`, { cache: 'no-store' })
        if (!res.ok) throw new Error('효과를 불러오지 못했습니다')
        const data: Effect = await res.json()
        if (!cancelled) setEffect(data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '효과를 불러오지 못했습니다')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [logId])

  if (error) return <p className="mt-2 text-xs text-destructive">{error}</p>
  if (!effect) {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        불러오는 중...
      </p>
    )
  }
  if ('unavailable' in effect) {
    return <p className="mt-2 text-xs text-muted-foreground">{effect.unavailable}</p>
  }

  const { before, after, ranks } = effect
  return (
    <div className="mt-2 space-y-2 rounded-md border bg-background p-2.5 text-xs">
      <p className="font-medium">{effect.label}</p>
      <table className="w-full text-left">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-0.5 font-normal">지표</th>
            <th className="py-0.5 font-normal">
              변경 전 ({before.from}~{before.to})
            </th>
            <th className="py-0.5 font-normal">
              변경 후 ({after.from}~{after.to})
            </th>
            <th className="py-0.5 font-normal">변화</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          <tr>
            <td className="py-0.5">판매 수량</td>
            <td>{before.quantity.toLocaleString()}</td>
            <td>{after.quantity.toLocaleString()}</td>
            <td>{pct(after.quantity, before.quantity)}</td>
          </tr>
          <tr>
            <td className="py-0.5">매출</td>
            <td>{before.revenue.toLocaleString()}원</td>
            <td>{after.revenue.toLocaleString()}원</td>
            <td>{pct(after.revenue, before.revenue)}</td>
          </tr>
        </tbody>
      </table>
      {!after.complete && (
        <p className="text-amber-600 dark:text-amber-400">
          관찰 중 {after.observedDays}/{OBSERVE_DAYS}일
        </p>
      )}
      {ranks.length > 0 && (
        <table className="w-full text-left">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-0.5 font-normal">키워드</th>
              <th className="py-0.5 font-normal">변경 전 순위</th>
              <th className="py-0.5 font-normal">변경 후 순위</th>
            </tr>
          </thead>
          <tbody>
            {ranks.map((r) => (
              <tr key={`${r.source}-${r.keyword}`}>
                <td className="py-0.5">
                  {r.keyword}
                  <span className="ml-1 text-muted-foreground">{sourceLongLabel(r.source)}</span>
                </td>
                <td>{formatRankNumber(r.before)}</td>
                <td>{formatRankNumber(r.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Chip({ tone, children }: { tone: 'added' | 'removed'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs',
        tone === 'added'
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'border-destructive/40 bg-destructive/10 text-destructive line-through'
      )}
    >
      {children}
    </span>
  )
}

/** 서버·클라이언트 로케일 차이를 피하려고 ISO 문자열을 직접 자른다(KST 변환은 브라우저에 맡긴다). */
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
