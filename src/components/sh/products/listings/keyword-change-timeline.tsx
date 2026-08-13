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

type ChangeLog = {
  id: string
  beforeName: string | null
  afterName: string | null
  beforeKeywords: string[]
  afterKeywords: string[]
  reason: KeywordChangeReason
  reasonNote: string | null
  observeMetric: string | null
  multiChange: boolean
  createdAt: string
}

type Props = {
  /** 리스팅 단위 이력. listing PATCH 가 남긴 기록이 여기로 묶인다. */
  listingId?: string | null
  /** 상품 단위 이력. 채널 상품(그룹) PATCH 는 listingId 없이 productId 로만 남는다. */
  productId?: string | null
  /**
   * 조회 키를 만들 수 없는 경우의 안내 문구. 예: 혼합 구성 채널 상품은
   * 서버가 productId 를 특정하지 못해 이력이 어느 키로도 조회되지 않는다.
   */
  unavailableReason?: string | null
  /** 저장 후 목록을 다시 불러오기 위한 신호. 값이 바뀔 때마다 재조회한다. */
  refreshKey?: number
  /** 상품 단위 조회는 채널을 가리지 않으므로 그 사실을 함께 알린다. */
  crossChannelNotice?: boolean
}

const PAGE_SIZE = 20

export function KeywordChangeTimeline({
  listingId,
  productId,
  unavailableReason,
  refreshKey = 0,
  crossChannelNotice = false,
}: Props) {
  const [rows, setRows] = useState<ChangeLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const queryKey = listingId ?? productId ?? null
  const disabled = Boolean(unavailableReason) || !queryKey

  const load = useCallback(
    async (targetPage: number) => {
      if (disabled) return
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (listingId) params.set('listingId', listingId)
        else if (productId) params.set('productId', productId)
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
    [disabled, listingId, productId]
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
          상품명·검색어를 언제 왜 바꿨는지의 기록입니다. 수정·삭제할 수 없습니다.
          {crossChannelNotice && ' 이 상품의 다른 채널 기록도 함께 표시됩니다.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {unavailableReason ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {unavailableReason}
          </p>
        ) : error ? (
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
        <Badge variant="secondary">{KEYWORD_CHANGE_REASON_LABELS[row.reason]}</Badge>
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
    </li>
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
