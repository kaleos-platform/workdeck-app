'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  kstDateKey,
  type CampaignNegativeKeywords,
  type NegativeKeywordCandidatesResponse,
} from '@/lib/coupang-ads/negative-keyword-rules'

const API_ACTION = '/api/coupang-ads/negative-keywords'
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

type Action = 'remove' | 'undo' | 'dismiss' | 'undismiss'

/** POST 공통 — 실패하면 서버 error 메시지로 throw */
async function postAction(
  action: Action,
  campaignId: string,
  keywords: string[],
  removedAt?: string
): Promise<{ count?: number; removedAt?: string }> {
  const res = await fetch(API_ACTION, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, campaignId, keywords, removedAt }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.message ?? '요청에 실패했습니다')
  return json
}

export function NegativeKeywordsView() {
  const [data, setData] = useState<NegativeKeywordCandidatesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // 한 번에 한 캠페인만 선택
  const [selection, setSelection] = useState<{ campaignId: string; keywords: string[] } | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  // 상태 갱신 전 더블클릭으로 remove 가 두 번 나가지 않게 동기 잠금
  const removingRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/coupang-ads/negative-keyword-candidates')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message ?? '불러오지 못했습니다')
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /** 캠페인 카드의 후보 목록·제거 수를 로컬에서 갱신 */
  const patchCampaign = (
    campaignId: string,
    fn: (c: CampaignNegativeKeywords) => CampaignNegativeKeywords
  ) =>
    setData((d) =>
      d ? { ...d, campaigns: d.campaigns.map((c) => (c.campaignId === campaignId ? fn(c) : c)) } : d
    )

  const toggle = (campaignId: string, keywords: string[], checked: boolean) =>
    setSelection((prev) => {
      const base = prev?.campaignId === campaignId ? prev.keywords : []
      const next = checked
        ? [...new Set([...base, ...keywords])]
        : base.filter((k) => !keywords.includes(k))
      return next.length ? { campaignId, keywords: next } : null
    })

  const handleDismiss = async (c: CampaignNegativeKeywords) => {
    if (selection?.campaignId !== c.campaignId) return
    const keywords = selection.keywords
    setBusy(true)
    try {
      await postAction('dismiss', c.campaignId, keywords)
      setSelection(null)
      await load()
      toast.success(`${c.campaignName} — ${keywords.length}개를 30일 동안 숨겼습니다`, {
        action: {
          label: '되돌리기',
          onClick: () =>
            postAction('undismiss', c.campaignId, keywords).then(load, (e) =>
              toast.error(e.message)
            ),
        },
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '처리하지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveCopy = async (c: CampaignNegativeKeywords) => {
    if (selection?.campaignId !== c.campaignId || removingRef.current) return
    removingRef.current = true
    const keywords = selection.keywords
    // 사용자 제스처 안에서 가장 먼저 복사. 실패하면 제거 기록도 남기지 않는다.
    try {
      await navigator.clipboard.writeText(keywords.join(','))
    } catch {
      toast.error('클립보드에 복사하지 못했습니다. 제거 표시는 하지 않았습니다')
      removingRef.current = false
      return
    }
    setBusy(true)
    try {
      const { removedAt, count: removed = 0 } = await postAction('remove', c.campaignId, keywords)
      setSelection(null)
      patchCampaign(c.campaignId, (x) => ({
        ...x,
        removedCount: x.removedCount + removed,
        candidates: x.candidates.filter((k) => !keywords.includes(k.keyword)),
      }))
      toast.success(`${c.campaignName} — ${keywords.length}개 제거 표시, 클립보드에 복사됨`, {
        action: {
          label: '되돌리기',
          onClick: () =>
            postAction('undo', c.campaignId, keywords, removedAt)
              .then(({ count }) => {
                if ((count ?? 0) < removed) {
                  toast.info('일부는 다른 사람이 다시 제거해 되돌리지 않았습니다')
                }
                return load()
              })
              .catch((e) => toast.error(e.message)),
        },
      })
    } catch {
      toast.error('복사는 됐지만 제거 기록에 실패했습니다. 다시 눌러 주세요')
    } finally {
      setBusy(false)
      removingRef.current = false
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>제외 키워드를 불러오지 못했습니다</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  const { rules: r, period } = data
  const withCandidates = data.campaigns.filter((c) => c.candidates.length > 0)
  const withoutCandidates = data.campaigns.filter((c) => c.candidates.length === 0)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">제외 키워드</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          최근 {r.WINDOW_DAYS}일({period.start} ~ {period.end}) 광고비{' '}
          {(r.MIN_AD_COST / 10_000).toLocaleString('ko-KR')}만 원 이상 · 클릭 {r.MIN_CLICKS}회 이상
          · 주문 0 · {r.PROTECT_DAYS}일 주문 없음 — 최근 14일 주문은 확정 전
        </p>
      </div>

      {data.spendingAfterRemoval.length > 0 && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle />
          <AlertTitle>제거했는데 지출 중 {data.spendingAfterRemoval.length}개</AlertTitle>
          <AlertDescription className="text-amber-800 dark:text-amber-300">
            <p>워크덱에서 제거 표시했지만 광고센터에 등록되지 않았을 수 있습니다.</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs underline">목록 펼치기</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {data.spendingAfterRemoval.map((s) => (
                  <li key={`${s.campaignId}-${s.keyword}`}>
                    {s.campaignName} · <b>{s.keyword}</b> · 제거일{' '}
                    {kstDateKey(new Date(s.removedAt))} · 마지막 지출 {s.lastSpendDate} (
                    {won(s.lastSpendAmount)})
                  </li>
                ))}
              </ul>
            </details>
          </AlertDescription>
        </Alert>
      )}

      {withCandidates.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium">지금 제외할 키워드가 없습니다</p>
            <p className="mt-1 text-xs text-muted-foreground">
              위 기준을 모두 만족하는 검색어가 생기면 여기에 나타납니다.
            </p>
          </CardContent>
        </Card>
      )}

      {withCandidates.map((c) => {
        const sel = selection?.campaignId === c.campaignId ? selection.keywords : []
        const all = sel.length === c.candidates.length
        return (
          <Card key={c.campaignId} data-testid={`campaign-${c.campaignId}`}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">{c.campaignName}</CardTitle>
              <span className="text-xs text-muted-foreground">
                워크덱에서 제거한 키워드 {c.removedCount}개
              </span>
            </CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        aria-label={`${c.campaignName} 전체 선택`}
                        checked={all}
                        onCheckedChange={(v) =>
                          toggle(
                            c.campaignId,
                            c.candidates.map((k) => k.keyword),
                            v === true
                          )
                        }
                      />
                    </TableHead>
                    <TableHead>검색어</TableHead>
                    <TableHead className="hidden text-right md:table-cell">30일 광고비</TableHead>
                    <TableHead className="hidden text-right md:table-cell">클릭</TableHead>
                    <TableHead className="hidden text-right md:table-cell">14일 주문</TableHead>
                    <TableHead className="hidden md:table-cell">마지막 지출일</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.candidates.map((k) => (
                    <TableRow key={k.keyword}>
                      <TableCell>
                        <Checkbox
                          aria-label={`${k.keyword} 선택`}
                          checked={sel.includes(k.keyword)}
                          onCheckedChange={(v) => toggle(c.campaignId, [k.keyword], v === true)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{k.keyword}</div>
                        {/* 모바일은 지표를 검색어 아래 한 줄로 */}
                        <div className="text-xs text-muted-foreground md:hidden">
                          {won(k.adCost30)} · 클릭 {k.clicks30} · 주문 {k.orders30} ·{' '}
                          {k.lastSpendDate ?? '-'}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {won(k.adCost30)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {k.clicks30}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {k.orders30}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {k.lastSpendDate ?? '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || sel.length === 0}
                  onClick={() => handleDismiss(c)}
                >
                  제외 안 함
                </Button>
                <Button
                  size="sm"
                  disabled={busy || sel.length === 0}
                  onClick={() => handleRemoveCopy(c)}
                >
                  제거 후 복사 ({sel.length}개 선택)
                </Button>
              </div>
              <ProtectedList c={c} />
            </CardContent>
          </Card>
        )
      })}

      {withoutCandidates.map((c) => (
        <div
          key={c.campaignId}
          className="rounded-lg border px-4 py-3 text-sm text-muted-foreground"
        >
          <span className="font-medium text-foreground">{c.campaignName}</span> — 제외 후보 없음
          {c.protected.length > 0 && (
            <div className="mt-2">
              <ProtectedList c={c} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** 90일 주문이 있어 제외 대상이 아닌 키워드 — 선택 불가, 이유만 표시 */
function ProtectedList({ c }: { c: CampaignNegativeKeywords }) {
  if (c.protected.length === 0) return null
  return (
    <details className="group rounded-md border px-3 py-2 text-sm">
      <summary className="flex cursor-pointer items-center gap-1 text-muted-foreground">
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        90일 주문 있어 제외 {c.protected.length}개
      </summary>
      <ul className="mt-2 space-y-1 text-xs">
        {c.protected.map((p) => (
          <li key={p.keyword}>
            <b>{p.keyword}</b> · 90일 주문 {p.orders90}건 · 매출 {won(p.revenue90)} · ROAS{' '}
            {p.roas90 === null ? '-' : `${p.roas90}%`}
          </li>
        ))}
      </ul>
    </details>
  )
}
