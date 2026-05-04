'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ContentStatusBadge } from '@/components/sc/contents/content-status-badge'
import {
  AnalyticsFilters,
  type AnalyticsFiltersValue,
  type ChannelOption,
} from './analytics-filters'
import type { SpaceContentAnalyticsRow } from '@/lib/sc/metrics'

// ─── 정렬 타입 ─────────────────────────────────────────────────────────────

type SortKey = 'title' | 'latestPublishedAt' | 'impressions' | 'views' | 'likes' | 'clicks'
type SortDir = 'asc' | 'desc'

interface SortState {
  key: SortKey
  dir: SortDir
}

// ─── Props ─────────────────────────────────────────────────────────────────

interface Props {
  /** 서버에서 fetch 한 콘텐츠 행 배열 */
  contents: SpaceContentAnalyticsRow[]
  /** 실제 등록된 채널 목록 (필터 UI 용) */
  channels: ChannelOption[]
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────

/** MM-DD 포맷 (같은 연도) 또는 YYYY-MM-DD */
function formatDate(d: Date | null): string {
  if (!d) return '—'
  const date = new Date(d)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

function numStr(n: number): string {
  return n === 0 ? '—' : n.toLocaleString()
}

/** 채널 배지 (최대 maxShow 개 + 나머지 개수) */
function ChannelBadges({
  channels,
  maxShow = 3,
}: {
  channels: SpaceContentAnalyticsRow['channels']
  maxShow?: number
}) {
  const shown = channels.slice(0, maxShow)
  const rest = channels.length - shown.length

  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((ch) => (
        <Badge key={ch.id} variant="secondary" className="px-1.5 py-0 text-[11px] font-normal">
          {ch.name}
        </Badge>
      ))}
      {rest > 0 && <span className="text-[11px] text-muted-foreground">+{rest}</span>}
      {channels.length === 0 && <span className="text-[11px] text-muted-foreground">—</span>}
    </div>
  )
}

/** 정렬 아이콘 */
function SortIcon({ col, sort }: { col: SortKey; sort: SortState }) {
  if (sort.key !== col) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />
  return sort.dir === 'asc' ? (
    <ArrowUp className="ml-1 inline h-3 w-3" />
  ) : (
    <ArrowDown className="ml-1 inline h-3 w-3" />
  )
}

// ─── 필터 로직 ─────────────────────────────────────────────────────────────

function applyFilters(
  rows: SpaceContentAnalyticsRow[],
  filters: AnalyticsFiltersValue
): SpaceContentAnalyticsRow[] {
  return rows.filter((row) => {
    // 검색
    if (filters.search && !row.title.toLowerCase().includes(filters.search.toLowerCase())) {
      return false
    }

    // 유형 (채널의 kind 기준)
    if (filters.kind !== 'ALL') {
      const hasKind = row.channels.some((ch) => ch.kind === filters.kind)
      if (!hasKind) return false
    }

    // 플랫폼 멀티셀렉트 (하나라도 일치하면 포함)
    if (filters.platforms.length > 0) {
      const hasPlatform = row.channels.some((ch) => filters.platforms.includes(ch.platform))
      if (!hasPlatform) return false
    }

    // 채널 멀티셀렉트
    if (filters.channelIds.length > 0) {
      const hasChannel = row.channels.some((ch) => filters.channelIds.includes(ch.id))
      if (!hasChannel) return false
    }

    return true
  })
}

// ─── 정렬 로직 ─────────────────────────────────────────────────────────────

function applySort(rows: SpaceContentAnalyticsRow[], sort: SortState): SpaceContentAnalyticsRow[] {
  return [...rows].sort((a, b) => {
    let cmp = 0

    switch (sort.key) {
      case 'title':
        cmp = a.title.localeCompare(b.title, 'ko')
        break
      case 'latestPublishedAt': {
        const ta = a.latestPublishedAt?.getTime() ?? -Infinity
        const tb = b.latestPublishedAt?.getTime() ?? -Infinity
        cmp = ta - tb
        break
      }
      case 'impressions':
        cmp = a.metrics.impressions - b.metrics.impressions
        break
      case 'views':
        cmp = a.metrics.views - b.metrics.views
        break
      case 'likes':
        cmp = a.metrics.likes - b.metrics.likes
        break
      case 'clicks':
        cmp =
          a.metrics.internalClicks +
          a.metrics.externalClicks -
          (b.metrics.internalClicks + b.metrics.externalClicks)
        break
    }

    return sort.dir === 'asc' ? cmp : -cmp
  })
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────

export function AnalyticsContentTable({ contents, channels }: Props) {
  const router = useRouter()

  const [sort, setSort] = useState<SortState>({ key: 'latestPublishedAt', dir: 'desc' })
  const [filters, setFilters] = useState<AnalyticsFiltersValue>({
    kind: 'ALL',
    platforms: [],
    channelIds: [],
    search: '',
  })

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'latestPublishedAt' ? 'desc' : 'desc' }
    )
  }

  const rows = useMemo(
    () => applySort(applyFilters(contents, filters), sort),
    [contents, filters, sort]
  )

  type Col = { key: SortKey; label: string; align?: 'right' }
  const columns: Col[] = [
    { key: 'title', label: '제목' },
    { key: 'latestPublishedAt', label: '게시일' },
    { key: 'impressions', label: '노출', align: 'right' },
    { key: 'views', label: '조회', align: 'right' },
    { key: 'likes', label: '좋아요', align: 'right' },
    { key: 'clicks', label: '클릭', align: 'right' },
  ]

  return (
    <div className="space-y-4">
      <AnalyticsFilters channels={channels} value={filters} onChange={setFilters} />

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  onClick={() => toggleSort(col.key)}
                  className={[
                    'cursor-pointer px-3 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground transition select-none hover:text-foreground',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  ].join(' ')}
                >
                  {col.label}
                  <SortIcon col={col.key} sort={sort} />
                </th>
              ))}
              {/* 채널 컬럼 — 정렬 불가 */}
              <th
                scope="col"
                className="px-3 py-2 text-left text-xs font-medium text-muted-foreground"
              >
                채널
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="border-t border-dashed px-3 py-10 text-center text-sm text-muted-foreground"
                >
                  표시할 콘텐츠가 없습니다.
                  {filters.search ||
                  filters.kind !== 'ALL' ||
                  filters.platforms.length > 0 ||
                  filters.channelIds.length > 0
                    ? ' 필터를 조정해 보세요.'
                    : ' 콘텐츠를 게시하면 이곳에 성과가 집계됩니다.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const clicks = row.metrics.internalClicks + row.metrics.externalClicks
                return (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/d/sales-content/contents/${row.id}`)}
                    className="cursor-pointer border-t transition hover:bg-accent/50"
                  >
                    {/* 제목 + 상태 배지 */}
                    <td className="max-w-[260px] px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <ContentStatusBadge status={row.status} />
                        <span className="truncate font-medium">{row.title}</span>
                      </div>
                    </td>
                    {/* 게시일 */}
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                      {formatDate(row.latestPublishedAt)}
                    </td>
                    {/* 노출 */}
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {numStr(row.metrics.impressions)}
                    </td>
                    {/* 조회 */}
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {numStr(row.metrics.views)}
                    </td>
                    {/* 좋아요 */}
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {numStr(row.metrics.likes)}
                    </td>
                    {/* 클릭 */}
                    <td className="px-3 py-2.5 text-right tabular-nums">{numStr(clicks)}</td>
                    {/* 채널 배지 */}
                    <td className="px-3 py-2.5">
                      <ChannelBadges channels={row.channels} />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {rows.length}개 콘텐츠
          {rows.length !== contents.length && ` (전체 ${contents.length}개 중 필터됨)`}
        </p>
      )}
    </div>
  )
}
