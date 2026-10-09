'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FloatingActionBar, floatingActionButtonClass } from '@/components/ui/floating-action-bar'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { wingListingUrl } from '@/lib/coupang/wing-link'
import { applyRangeSelection } from '@/lib/range-selection'
import type { MatchingListing, MatchingRow } from '@/lib/sh/coupang-price/load-matching'
import type { MatchStatus } from '@/lib/sh/coupang-price/match-candidates'

const STATUS_LABEL: Record<MatchStatus, string> = {
  NEEDS_REVIEW: '확인 필요',
  CANDIDATE: '후보',
  AMBIGUOUS: '모호',
  NONE: '수동',
  CONFIRMED: '확정',
  EXCLUDED: '매칭 안 함',
}
const STATUS_CLASS: Record<MatchStatus, string> = {
  NEEDS_REVIEW: 'border-amber-400 text-amber-700',
  CANDIDATE: 'border-blue-300 text-blue-700',
  AMBIGUOUS: 'border-amber-300 text-amber-700',
  NONE: 'text-muted-foreground',
  CONFIRMED: 'border-emerald-300 text-emerald-700',
  EXCLUDED: 'border-slate-300 text-slate-500',
}

type Filter = MatchStatus | 'ALL'

/** 다른 상품 선택 팝업의 검색 결과 행 */
type PickListing = MatchingListing & { linkedItemId: string | null }

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

const won = (n: number | null) => (n == null ? '—' : `₩${n.toLocaleString('ko-KR')}`)

/** 쿠팡 옵션 쪽 — 상품명(재고 기준) + 옵션명 + 옵션 ID */
function CoupangItemLabel({ r }: { r: MatchingRow }) {
  return (
    <>
      <span className="flex items-center gap-1 font-medium">
        {r.productName ?? r.itemName ?? r.sellerProductId}
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
      {r.productName && r.itemName && <span className="block text-sm">옵션: {r.itemName}</span>}
      {r.stopSuggested && r.status !== 'EXCLUDED' && (
        <Badge variant="outline" className="mt-0.5 border-slate-300 text-[11px] text-slate-500">
          판매중지 — 매칭 안 함 추천
        </Badge>
      )}
      <span className="block text-xs text-muted-foreground">
        RG {r.rgVendorItemId ?? '—'} · 판매자배송 {r.mpVendorItemId ?? '—'}
      </span>
    </>
  )
}

/** 판매채널 상품 쪽 — 확정 전에 대조할 이름·구성·판매가·근거 */
function ListingCard({
  listing,
  basisSku,
  action,
}: {
  listing: MatchingListing
  basisSku?: string | null
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/20 px-3 py-2">
      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
        <p className="font-medium">{listing.name}</p>
        <p className="text-xs">
          구성:{' '}
          {listing.composition.length > 0
            ? listing.composition.map((c) => `${c.label} ×${c.quantity}`).join(' + ')
            : '—'}
          <span className="ml-2 text-muted-foreground">
            워크덱 판매가 {won(listing.retailPrice)}
          </span>
        </p>
        {basisSku && (
          <p className="text-xs text-muted-foreground">
            근거: 재고 매핑 SKU {basisSku} 의 구성과 일치
          </p>
        )}
      </div>
      {action}
    </div>
  )
}

export function CoupangMatchingView() {
  const [rows, setRows] = useState<MatchingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  // 일괄 확정 전 확인 팝업 — 열 때의 목록을 고정해, 보는 목록과 확정되는 목록이 어긋나지 않게 한다.
  const [bulkRows, setBulkRows] = useState<MatchingRow[] | null>(null)
  // 진행 중인 쿠팡 상품 불러오기(워커 잡) id — 끝나면 목록을 자동으로 다시 조회한다.
  // 불리언이 아니라 id 로 들고 있어야 이전 잡의 결과를 새 잡으로 착각하지 않는다.
  const [syncJobId, setSyncJobId] = useState<string | null>(null)
  const syncing = syncJobId != null
  // 목록 필터 — ALL 은 매칭 안 함을 뺀 전체
  const [filter, setFilter] = useState<Filter>('ALL')
  const [query, setQuery] = useState('')
  // 다른 상품 선택 팝업 대상
  const [pickRow, setPickRow] = useState<MatchingRow | null>(null)
  // 다중 선택 — 체크박스 + Shift 범위 선택, 하단 일괄 액션 바(판매채널 상품 화면과 같은 패턴)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastClickedIndex = useRef<number | null>(null)
  // 필터·검색을 바꾸면 보이지 않는 항목이 선택된 채 일괄 처리되지 않게 선택을 비운다.
  useEffect(() => {
    setSelected(new Set())
    lastClickedIndex.current = null
  }, [filter, query])

  // silent: 처리 후 재조회는 표를 "불러오는 중"으로 갈아끼우지 않는다(스크롤·맥락 유지).
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const data = (await send('/api/sh/coupang-price/matching', 'GET')) as { rows: MatchingRow[] }
      setRows(data.rows)
      // 재조회로 사라진 항목은 선택에서 빼고, 순서가 바뀌었을 수 있으니 범위 기준점도 초기화한다.
      const ids = new Set(data.rows.map((r) => r.id))
      setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))))
      lastClickedIndex.current = null
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
          void load({ silent: true })
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
      EXCLUDED: 0,
    }
    for (const r of rows) c[r.status] += 1
    return c
  }, [rows])

  async function confirm(
    pairs: Array<{ coupangProductItemId: string; listingId: string }>,
    explicit = false
  ): Promise<boolean> {
    setBusy(true)
    try {
      const r = (await send('/api/sh/coupang-price/matching/confirm', 'POST', {
        pairs,
        explicit,
      })) as {
        confirmed: number
        skipped: Array<{ reason: string }>
      }
      if (r.confirmed > 0) {
        toast.success(
          `${r.confirmed}건 확정${r.skipped.length ? ` · ${r.skipped.length}건 건너뜀` : ''}`
        )
      }
      if (r.skipped.length) toast.warning(r.skipped[0].reason)
      await load({ silent: true })
      return r.confirmed > 0
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '확정 실패')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function unlink(id: string) {
    setBusy(true)
    try {
      await send('/api/sh/coupang-price/link', 'DELETE', { coupangProductItemId: id })
      await load({ silent: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '해제 실패')
    } finally {
      setBusy(false)
    }
  }

  async function setExcluded(ids: string[], excluded: boolean) {
    if (ids.length === 0) return
    setBusy(true)
    try {
      const r = (await send('/api/sh/coupang-price/matching/exclude', 'POST', {
        coupangProductItemIds: ids,
        excluded,
      })) as { updated: number }
      toast.success(
        excluded
          ? `${r.updated}건을 매칭 안 함으로 바꿨습니다`
          : `${r.updated}건의 매칭 안 함을 해제했습니다`
      )
      // 처리한 항목만 선택에서 뺀다 — 행 버튼 하나로 만들어 둔 다중 선택이 날아가지 않게.
      setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
      await load({ silent: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '변경 실패')
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

  const q = query.trim().toLowerCase()
  const visibleRows = rows.filter((r) => {
    if (filter === 'ALL' ? r.status === 'EXCLUDED' : r.status !== filter) return false
    if (!q) return true
    return [r.productName, r.itemName, r.listing?.name, ...r.candidates.map((c) => c.name)]
      .filter(Boolean)
      .some((t) => t!.toLowerCase().includes(q))
  })

  // 보이는 목록 기준 — 필터·검색 중엔 화면에 보이는 후보만 일괄 확정한다.
  const candidateRows = visibleRows.filter(
    (r) => r.status === 'CANDIDATE' && r.candidates.length === 1
  )
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id))
  const someVisibleSelected = visibleRows.some((r) => selected.has(r.id)) && !allVisibleSelected
  // 화면에 보이는 선택만 처리 대상 — 재조회로 필터 밖으로 나간 항목이 몰래 처리되지 않게.
  const selectedRows = visibleRows.filter((r) => selected.has(r.id))
  const toExclude = selectedRows.filter((r) => r.status !== 'EXCLUDED').map((r) => r.id)
  const toRestore = selectedRows.filter((r) => r.status === 'EXCLUDED').map((r) => r.id)

  function toggleAllVisible(checked: boolean) {
    setSelected(checked ? new Set(visibleRows.map((r) => r.id)) : new Set())
    lastClickedIndex.current = null
  }

  function toggleOne(id: string, index: number, shiftKey: boolean) {
    // updater 가 나중에 실행돼도 이번 클릭 기준점을 쓰도록 미리 잡아둔다.
    const last = lastClickedIndex.current
    const keys = visibleRows.map((r) => r.id)
    setSelected((prev) => applyRangeSelection(prev, keys, id, index, shiftKey, last))
    lastClickedIndex.current = index
  }

  const candidatePairs = candidateRows.map((r) => ({
    coupangProductItemId: r.id,
    listingId: r.candidates[0].id,
  }))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={() => setFilter('ALL')}>
          <Badge variant={filter === 'ALL' ? 'default' : 'outline'}>
            전체 {rows.length - counts.EXCLUDED}
          </Badge>
        </button>
        {(Object.keys(STATUS_LABEL) as MatchStatus[]).map((s) => (
          <button key={s} type="button" onClick={() => setFilter(filter === s ? 'ALL' : s)}>
            <Badge
              variant="outline"
              className={`${STATUS_CLASS[s]} ${filter === s ? 'ring-2 ring-offset-1' : ''}`}
            >
              {STATUS_LABEL[s]} {counts[s]}
            </Badge>
          </button>
        ))}
        <div className="relative w-56">
          <Search className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="상품명·옵션 검색"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={busy || syncing} onClick={syncNow}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? '쿠팡 상품 불러오는 중…' : '지금 쿠팡 상품 불러오기'}
          </Button>
          <Button
            size="sm"
            disabled={busy || candidatePairs.length === 0}
            onClick={() => setBulkRows(candidateRows)}
          >
            후보 {candidatePairs.length}건 일괄 확정
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allVisibleSelected || (someVisibleSelected ? 'indeterminate' : false)}
                  onCheckedChange={(v) => toggleAllVisible(v === true)}
                  aria-label="보이는 항목 전체 선택"
                  disabled={busy}
                />
              </TableHead>
              <TableHead className="w-[34%]">쿠팡 옵션</TableHead>
              <TableHead className="w-[170px] text-right whitespace-normal">
                쿠팡 현재가
                <br />
                RG / 판매자배송
              </TableHead>
              <TableHead className="w-[90px]">상태</TableHead>
              <TableHead>판매채널 상품</TableHead>
              <TableHead className="w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  수집된 쿠팡 상품이 없습니다. “지금 쿠팡 상품 불러오기”를 눌러주세요
                </TableCell>
              </TableRow>
            ) : visibleRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  조건에 맞는 쿠팡 옵션이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((r, ri) => (
                <TableRow
                  key={r.id}
                  className={
                    selected.has(r.id)
                      ? 'bg-primary/5'
                      : r.status === 'EXCLUDED'
                        ? 'opacity-60'
                        : undefined
                  }
                >
                  <TableCell>
                    <Checkbox
                      checked={selected.has(r.id)}
                      onClick={(e: React.MouseEvent) => toggleOne(r.id, ri, e.shiftKey)}
                      onCheckedChange={() => {}}
                      aria-label={`${r.productName ?? r.itemName ?? r.id} 선택`}
                      disabled={busy}
                    />
                  </TableCell>
                  <TableCell className="break-words whitespace-normal">
                    <CoupangItemLabel r={r} />
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
                      <div className="space-y-1">
                        <ListingCard listing={r.listing} />
                        {r.status === 'NEEDS_REVIEW' && r.candidates[0] && (
                          <>
                            <p className="text-xs text-amber-700">
                              재고 매핑 기준으로는 아래 상품이 맞습니다 — 확인 후 연결을 해제하고
                              다시 확정하세요
                            </p>
                            <ListingCard listing={r.candidates[0]} basisSku={r.basisSku} />
                          </>
                        )}
                      </div>
                    ) : r.candidates.length > 0 ? (
                      <div className="space-y-1">
                        {r.status === 'AMBIGUOUS' && r.conflicts.length > 0 && (
                          <p className="text-xs text-amber-700">
                            같은 판매채널 상품을 다른 쿠팡 옵션도 가리킵니다:{' '}
                            <span className="font-medium">
                              {r.conflicts.map((c) => c.label).join(', ')}
                            </span>{' '}
                            — 가격을 쓸 쪽 하나만 확정하고, 나머지는 매칭 안 함으로 바꾸세요
                          </p>
                        )}
                        {r.status === 'AMBIGUOUS' && r.conflicts.length === 0 && (
                          <p className="text-xs text-amber-700">
                            같은 구성의 판매채널 상품이 여러 개입니다 — 맞는 것을 골라 확정하세요
                          </p>
                        )}
                        {r.candidates.map((c) => (
                          <ListingCard
                            key={c.id}
                            listing={c}
                            basisSku={r.basisSku}
                            action={
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 shrink-0 text-xs"
                                disabled={busy}
                                onClick={() =>
                                  confirm([{ coupangProductItemId: r.id, listingId: c.id }])
                                }
                              >
                                확정
                              </Button>
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {r.status === 'EXCLUDED'
                          ? '매칭 안 함 — 가격 반영 대상이 아닙니다'
                          : r.basisSku
                            ? `재고 매핑 SKU ${r.basisSku} 와 같은 구성의 판매채널 상품이 없습니다 — “다른 상품 선택”으로 고르세요`
                            : '자동 후보가 없습니다 — “다른 상품 선택”으로 고르세요'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-stretch gap-1">
                      {r.status === 'EXCLUDED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={busy}
                          onClick={() => setExcluded([r.id], false)}
                        >
                          매칭 안 함 해제
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={busy}
                            onClick={() => setPickRow(r)}
                          >
                            다른 상품 선택
                          </Button>
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
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-muted-foreground"
                            disabled={busy}
                            onClick={() => setExcluded([r.id], true)}
                          >
                            매칭 안 함
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={bulkRows != null} onOpenChange={(v) => !busy && !v && setBulkRows(null)}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>후보 {bulkRows?.length ?? 0}건 일괄 확정</DialogTitle>
            <DialogDescription>
              아래 쿠팡 옵션과 판매채널 상품을 연결합니다. 연결된 상품은 가격시뮬에서 쿠팡 판매가로
              반영할 때 이 쿠팡 옵션에 가격이 쓰입니다.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">쿠팡 옵션</TableHead>
                  <TableHead>판매채널 상품</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(bulkRows ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="break-words whitespace-normal">
                      <CoupangItemLabel r={r} />
                    </TableCell>
                    <TableCell className="break-words whitespace-normal">
                      <ListingCard listing={r.candidates[0]} basisSku={r.basisSku} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setBulkRows(null)}>
              취소
            </Button>
            <Button
              disabled={busy || !bulkRows?.length}
              onClick={async () => {
                if (!bulkRows) return
                const ok = await confirm(
                  bulkRows.map((r) => ({
                    coupangProductItemId: r.id,
                    listingId: r.candidates[0].id,
                  }))
                )
                if (ok) setBulkRows(null)
              }}
            >
              {busy ? '확정 중...' : `${bulkRows?.length ?? 0}건 확정`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FloatingActionBar
        open={selectedRows.length > 0}
        onClear={() => setSelected(new Set())}
        clearDisabled={busy}
        actions={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={floatingActionButtonClass}
              disabled={busy || toExclude.length === 0}
              onClick={() => setExcluded(toExclude, true)}
            >
              매칭 안 함 ({toExclude.length})
            </Button>
            {toRestore.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={floatingActionButtonClass}
                disabled={busy}
                onClick={() => setExcluded(toRestore, false)}
              >
                매칭 안 함 해제 ({toRestore.length})
              </Button>
            )}
          </>
        }
      >
        <span className="text-sm font-semibold">{selectedRows.length}개</span>
        <span className="text-xs text-background/70">선택됨 · Shift+클릭으로 범위 선택</span>
      </FloatingActionBar>

      <ListingPickerDialog
        row={pickRow}
        busy={busy}
        onClose={() => setPickRow(null)}
        onPick={async (listingId) => {
          if (!pickRow) return
          // 서버가 기존 연결 교체·매칭 안 함 해제를 한 번의 update 로 처리한다(explicit).
          const ok = await confirm([{ coupangProductItemId: pickRow.id, listingId }], true)
          if (ok) setPickRow(null)
        }}
      />
    </div>
  )
}

/** 다른 상품 선택 — 쿠팡 리스팅 채널의 판매채널 상품을 검색해 고른다. */
function ListingPickerDialog({
  row,
  busy,
  onClose,
  onPick,
}: {
  row: MatchingRow | null
  busy: boolean
  onClose: () => void
  onPick: (listingId: string) => void | Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<PickListing[]>([])
  const [loading, setLoading] = useState(false)

  // 열릴 때 쿠팡 옵션명으로 검색을 시작한다. 이전 행의 결과가 잠깐이라도 보이지 않게 비운다.
  useEffect(() => {
    setResults([])
    if (row) setSearch(row.itemName ?? '')
  }, [row])

  useEffect(() => {
    if (!row) return
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const d = (await send(
          `/api/sh/coupang-price/listings?search=${encodeURIComponent(search)}&itemId=${encodeURIComponent(row.id)}`,
          'GET'
        )) as { listings: PickListing[] }
        if (!cancelled) setResults(d.listings)
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : '검색 실패')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [row, search])

  return (
    <Dialog open={row != null} onOpenChange={(v) => !busy && !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>판매채널 상품 선택</DialogTitle>
          <DialogDescription>
            {row && (
              <>
                <span className="font-medium text-foreground">
                  {[row.productName, row.itemName].filter(Boolean).join(' / ')}
                </span>{' '}
                에 연결할 판매채널 상품을 고르세요. 구성(옵션×수량)이 같은지 확인하세요. 다른 쿠팡
                옵션에 이미 연결된 상품은 목록에 나오지 않습니다.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="판매채널 상품명 검색"
          className="h-9"
        />
        <div className="space-y-1">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">검색 중...</p>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              검색 결과가 없습니다 — 검색어를 줄여보세요
            </p>
          ) : (
            results.map((l) => {
              const takenByOther = l.linkedItemId != null && l.linkedItemId !== row?.id
              return (
                <ListingCard
                  key={l.id}
                  listing={l}
                  action={
                    takenByOther ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        다른 쿠팡 옵션에 연결됨
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 text-xs"
                        disabled={busy || l.linkedItemId === row?.id}
                        onClick={() => onPick(l.id)}
                      >
                        {l.linkedItemId === row?.id ? '연결됨' : '이 상품으로 확정'}
                      </Button>
                    )
                  }
                />
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
