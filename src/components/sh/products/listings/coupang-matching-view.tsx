'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { wingListingUrl } from '@/lib/coupang/wing-link'
import type { MatchingRow } from '@/lib/sh/coupang-price/load-matching'
import type { MatchStatus } from '@/lib/sh/coupang-price/match-candidates'

const STATUS_LABEL: Record<MatchStatus, string> = {
  NEEDS_REVIEW: '확인 필요',
  CANDIDATE: '후보',
  AMBIGUOUS: '모호',
  NONE: '수동',
  CONFIRMED: '확정',
}
const STATUS_CLASS: Record<MatchStatus, string> = {
  NEEDS_REVIEW: 'border-amber-400 text-amber-700',
  CANDIDATE: 'border-blue-300 text-blue-700',
  AMBIGUOUS: 'border-amber-300 text-amber-700',
  NONE: 'text-muted-foreground',
  CONFIRMED: 'border-emerald-300 text-emerald-700',
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message ?? `요청 실패 (HTTP ${res.status})`)
  return data
}

type SyncJob = {
  id: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
  error: string | null
}

const SYNC_POLL_MS = 5_000
// 상품 API 수집은 실측 약 1.5분(55상품) — 넉넉히 5분.
const SYNC_POLL_LIMIT_MS = 5 * 60_000

export function CoupangMatchingView() {
  const [rows, setRows] = useState<MatchingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  // 진행 중인 쿠팡 상품 불러오기(워커 잡) id — 끝나면 목록을 자동으로 다시 조회한다.
  // 불리언이 아니라 id 로 들고 있어야 이전 잡의 결과를 새 잡으로 착각하지 않는다.
  const [syncJobId, setSyncJobId] = useState<string | null>(null)
  const syncing = syncJobId != null

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = (await send('/api/sh/coupang-price/matching', 'GET')) as { rows: MatchingRow[] }
      setRows(data.rows)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '매칭 목록 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  // 화면을 열었을 때 이미 불러오는 중이면 이어서 기다린다.
  useEffect(() => {
    let cancelled = false
    send('/api/sh/coupang-price/sync', 'GET')
      .then((d) => {
        const job = (d as { job: SyncJob | null }).job
        if (!cancelled && job && (job.status === 'PENDING' || job.status === 'RUNNING')) {
          setSyncJobId((cur) => cur ?? job.id)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // 불러오는 동안 5초 간격으로 잡 상태 확인 — 끝나면 목록 재조회 + 결과 안내.
  useEffect(() => {
    if (!syncJobId) return
    const startedAt = Date.now()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const d = (await send('/api/sh/coupang-price/sync', 'GET')) as { job: SyncJob | null }
        if (cancelled) return
        // 최근 잡이 우리가 기다리는 잡일 때만 판정한다.
        const job = d.job?.id === syncJobId ? d.job : null
        if (job && (job.status === 'SUCCEEDED' || job.status === 'PARTIAL')) {
          setSyncJobId(null)
          toast.success('쿠팡 상품을 불러왔습니다')
          void load()
          return
        }
        if (job && job.status === 'FAILED') {
          setSyncJobId(null)
          toast.error(`쿠팡 상품 불러오기 실패: ${job.error ?? '알 수 없는 오류'}`)
          return
        }
      } catch {
        // 일시적 조회 실패 — 다음 주기에 다시 확인
      }
      if (cancelled) return
      if (Date.now() - startedAt > SYNC_POLL_LIMIT_MS) {
        setSyncJobId(null)
        toast.error('워커가 아직 처리하지 않았습니다. 워커가 멈췄을 수 있습니다')
        return
      }
      timer = setTimeout(poll, SYNC_POLL_MS)
    }
    timer = setTimeout(poll, SYNC_POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [syncJobId, load])

  const counts = useMemo(() => {
    const c: Record<MatchStatus, number> = {
      NEEDS_REVIEW: 0,
      CANDIDATE: 0,
      AMBIGUOUS: 0,
      NONE: 0,
      CONFIRMED: 0,
    }
    for (const r of rows) c[r.status] += 1
    return c
  }, [rows])

  async function confirm(pairs: Array<{ coupangProductItemId: string; listingId: string }>) {
    setBusy(true)
    try {
      const r = (await send('/api/sh/coupang-price/matching/confirm', 'POST', { pairs })) as {
        confirmed: number
        skipped: Array<{ reason: string }>
      }
      toast.success(
        `${r.confirmed}건 확정${r.skipped.length ? ` · ${r.skipped.length}건 건너뜀` : ''}`
      )
      if (r.skipped.length) toast.warning(r.skipped[0].reason)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '확정 실패')
    } finally {
      setBusy(false)
    }
  }

  async function unlink(id: string) {
    setBusy(true)
    try {
      await send('/api/sh/coupang-price/link', 'DELETE', { coupangProductItemId: id })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '해제 실패')
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    setBusy(true)
    try {
      const d = (await send('/api/sh/coupang-price/sync', 'POST')) as { job: { id: string } }
      toast.success('쿠팡 상품을 불러오는 중입니다. 끝나면 목록이 자동으로 갱신됩니다')
      setSyncJobId(d.job.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '불러오기 실패')
    } finally {
      setBusy(false)
    }
  }

  const candidatePairs = rows
    .filter((r) => r.status === 'CANDIDATE')
    .map((r) => ({ coupangProductItemId: r.id, listingId: r.candidates[0].id }))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(Object.keys(STATUS_LABEL) as MatchStatus[]).map((s) => (
          <Badge key={s} variant="outline" className={STATUS_CLASS[s]}>
            {STATUS_LABEL[s]} {counts[s]}
          </Badge>
        ))}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={busy || syncing} onClick={syncNow}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? '쿠팡 상품 불러오는 중…' : '지금 쿠팡 상품 불러오기'}
          </Button>
          <Button
            size="sm"
            disabled={busy || candidatePairs.length === 0}
            onClick={() => confirm(candidatePairs)}
          >
            후보 {candidatePairs.length}건 일괄 확정
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[34%]">쿠팡 옵션</TableHead>
              <TableHead className="w-[170px] text-right whitespace-normal">
                쿠팡 현재가
                <br />
                RG / 판매자배송
              </TableHead>
              <TableHead className="w-[90px]">상태</TableHead>
              <TableHead>판매채널 상품</TableHead>
              <TableHead className="w-[90px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  수집된 쿠팡 상품이 없습니다. “지금 쿠팡 상품 불러오기”를 눌러주세요
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="break-words whitespace-normal">
                    <span className="flex items-center gap-1 font-medium">
                      {r.itemName ?? r.sellerProductId}
                      <a
                        href={wingListingUrl(r.sellerProductId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="쿠팡 Wing에서 보기"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      RG {r.rgVendorItemId ?? '—'} · 판매자배송 {r.mpVendorItemId ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {r.rgSalePrice?.toLocaleString('ko-KR') ?? '—'} /{' '}
                    {r.mpSalePrice?.toLocaleString('ko-KR') ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_CLASS[r.status]}>
                      {STATUS_LABEL[r.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm break-words whitespace-normal">
                    {r.listing ? (
                      <>
                        {r.listing.name}
                        {r.status === 'NEEDS_REVIEW' && r.candidates[0] && (
                          <p className="text-xs text-amber-700">
                            재고 매핑 기준 후보: {r.candidates[0].name}
                          </p>
                        )}
                      </>
                    ) : r.candidates.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {r.candidates.map((c) => (
                          <Button
                            key={c.id}
                            size="sm"
                            variant="ghost"
                            className="h-auto justify-start px-1 py-0.5 text-left text-xs whitespace-normal"
                            disabled={busy}
                            onClick={() =>
                              confirm([{ coupangProductItemId: r.id, listingId: c.id }])
                            }
                          >
                            {c.name} — 이걸로 확정
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        가격시뮬 반영 화면의 “쿠팡 옵션 연결”로 직접 연결하세요
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.listing && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={busy}
                        onClick={() => unlink(r.id)}
                      >
                        연결 해제
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
