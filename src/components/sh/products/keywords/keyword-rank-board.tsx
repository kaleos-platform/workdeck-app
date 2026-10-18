'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getSellerHubChannelProductPath, getSellerHubListingPath } from '@/lib/deck-routes'
import { cn } from '@/lib/utils'
import { KeywordRankHistoryDialog } from './keyword-rank-history-dialog'
import {
  formatRank,
  formatRankChange,
  sourceLongLabel,
  type RankSnapshot,
  type RankSource,
} from './rank-format'

type Target = {
  targetKey: string
  kind: 'channelProduct' | 'listing'
  id: string
  name: string
  channelName: string
  pageUrl: string | null
  source: RankSource | null
  keywords: Array<{ keyword: string; latest: RankSnapshot | null; prev7: RankSnapshot | null }>
}

type BoardData = { slotLimit: number; slotsUsed: number; targets: Target[] }

export function KeywordRankBoard() {
  const [data, setData] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ targetKey: string; keyword: string } | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/sh/keyword-ranks', { cache: 'no-store' })
      if (!res.ok) throw new Error('키워드 순위를 불러오지 못했습니다')
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : '키워드 순위를 불러오지 못했습니다')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          다시 시도
        </Button>
      </div>
    )
  }
  if (!data) {
    return (
      <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        불러오는 중...
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        추적 슬롯{' '}
        <span className="font-medium text-foreground tabular-nums">
          {data.slotsUsed}/{data.slotLimit}
        </span>
      </p>

      {data.targets.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">
          추적 중인 판매채널 상품이 없습니다. 판매채널 상품 상세에서 &lsquo;키워드 순위
          추적&rsquo;을 켜면 등록된 키워드가 매일 기록됩니다.
        </p>
      ) : (
        data.targets.map((t) => (
          <TargetCard
            key={t.targetKey}
            target={t}
            onSelect={(keyword) => setSelected({ targetKey: t.targetKey, keyword })}
          />
        ))
      )}

      {selected && (
        <KeywordRankHistoryDialog
          open
          onOpenChange={(o) => {
            if (!o) setSelected(null)
          }}
          targetKey={selected.targetKey}
          keyword={selected.keyword}
        />
      )}
    </div>
  )
}

function TargetCard({ target, onSelect }: { target: Target; onSelect: (keyword: string) => void }) {
  const editHref =
    target.kind === 'channelProduct'
      ? getSellerHubChannelProductPath(target.id)
      : getSellerHubListingPath(target.id)
  const needsUrl = target.pageUrl == null || target.source == null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Link href={editHref} className="hover:underline">
            {target.name}
          </Link>
          <span className="text-sm font-normal text-muted-foreground">{target.channelName}</span>
          {target.source && <Badge variant="secondary">{sourceLongLabel(target.source)}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {needsUrl ? (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            상품 페이지 URL을 연결하면 추적됩니다.{' '}
            <Link href={editHref} className="text-foreground underline">
              상품 페이지 URL 연결하기
            </Link>
          </p>
        ) : target.source === 'COUPANG' ? (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            쿠팡 순위 수집은 준비 중입니다
          </p>
        ) : null}

        {target.keywords.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">키워드</th>
                <th className="py-1 font-normal">검색처</th>
                <th className="py-1 font-normal">현재 순위</th>
                <th className="py-1 font-normal">7일 변화</th>
                <th className="py-1 font-normal">기준일</th>
              </tr>
            </thead>
            <tbody>
              {target.keywords.map((k) => {
                const change = formatRankChange(k.latest, k.prev7)
                return (
                  <tr
                    key={k.keyword}
                    className="cursor-pointer border-t hover:bg-muted/30"
                    onClick={() => onSelect(k.keyword)}
                  >
                    <td className="py-1.5">
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelect(k.keyword)
                        }}
                      >
                        {k.keyword}
                      </button>
                    </td>
                    <td className="py-1.5 text-muted-foreground">
                      {target.source ? sourceLongLabel(target.source) : '—'}
                    </td>
                    <td className="py-1.5 tabular-nums">{formatRank(k.latest)}</td>
                    <td
                      className={cn(
                        'py-1.5 tabular-nums',
                        (change.startsWith('▲') || change === '진입') &&
                          'text-emerald-600 dark:text-emerald-400',
                        (change.startsWith('▼') || change === '이탈') && 'text-destructive'
                      )}
                    >
                      {change}
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground tabular-nums">
                      {k.latest?.date ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
