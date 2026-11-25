'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fetchWithMfa, redirectIfMfaRequired } from '@/lib/auth/mfa-client'
import type { AutofixKind, AutofixState } from '@/lib/sentry/autofix-status'

export type ErrorRow = {
  id: string
  shortId: string
  title: string
  culprit: string
  permalink: string
  count: number
  userCount: number
  lastSeen: string
  service: 'web' | 'worker'
  autofix: AutofixState
}

type Props = {
  rows: ErrorRow[]
  service: 'all' | 'web' | 'worker'
  status: AutofixKind | 'all'
  counts: { web: number; worker: number }
  lastActivity: { at: string; shortId: string; kind: AutofixKind } | null
}

const KIND_LABELS: Record<AutofixKind, string> = {
  none: '없음',
  request: '요청됨',
  running: '진행 중',
  pr: 'PR',
  analysis: '분석만',
  failed: '실패',
  skip: '제외',
}

function relativeTime(iso: string) {
  const sec = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (sec < 60) return '방금 전'
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`
  return `${Math.floor(sec / 86400)}일 전`
}

type SortKey = 'title' | 'service' | 'count' | 'userCount' | 'lastSeen' | 'autofix'
type SortDir = 'asc' | 'desc'

const SORT_VALUE: Record<SortKey, (r: ErrorRow) => string | number> = {
  title: (r) => r.title,
  service: (r) => r.service,
  count: (r) => r.count,
  userCount: (r) => r.userCount,
  lastSeen: (r) => Date.parse(r.lastSeen) || 0,
  autofix: (r) => KIND_LABELS[r.autofix.kind],
}
// 숫자·시각은 큰 값부터, 글자는 가나다순부터
const DESC_FIRST: SortKey[] = ['count', 'userCount', 'lastSeen']

function SortHead({
  label,
  k,
  sort,
  dir,
  onSort,
  className,
}: {
  label: string
  k: SortKey
  sort: SortKey | null
  dir: SortDir
  onSort: (k: SortKey) => void
  className?: string
}) {
  const active = sort === k
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <TableHead
      className={className}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon className={active ? 'size-3.5' : 'size-3.5 opacity-40'} />
      </button>
    </TableHead>
  )
}

// 조회 상한(25)에 걸린 목록이 있으면 + 를 붙인다
const countLabel = (n: number, capped: boolean) => `${n}${capped ? '+' : ''}`

export function ErrorsTable({ rows, service, status, counts, lastActivity }: Props) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  // null = 서버 순서(사용자 많은 순 → 발생 많은 순)
  const [sort, setSort] = useState<SortKey | null>(null)
  const [dir, setDir] = useState<SortDir>('desc')

  function onSort(k: SortKey) {
    if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(k)
      setDir(DESC_FIRST.includes(k) ? 'desc' : 'asc')
    }
  }

  const sorted = useMemo(() => {
    if (!sort) return rows
    const v = SORT_VALUE[sort]
    const sign = dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = v(a)
      const y = v(b)
      const c =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y), 'ko')
      return c * sign
    })
  }, [rows, sort, dir])

  function go(next: { service?: string; status?: string }) {
    const params = new URLSearchParams()
    const s = next.service ?? service
    const st = next.status ?? status
    if (s !== 'all') params.set('service', s)
    if (st !== 'all') params.set('status', st)
    const qs = params.toString()
    router.push(qs ? `/admin/errors?${qs}` : '/admin/errors')
  }

  async function act(row: ErrorRow, action: 'request' | 'skip') {
    setPendingId(row.id)
    try {
      const res = await fetchWithMfa(`/api/admin/errors/${row.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (await redirectIfMfaRequired(res)) return
      if (!res.ok) {
        toast.error('처리하지 못했습니다. 잠시 후 다시 시도해 주세요')
        return
      }
      toast.success(action === 'request' ? '수정을 요청했습니다' : '제외했습니다')
      router.refresh()
    } catch {
      toast.error('처리하지 못했습니다. 잠시 후 다시 시도해 주세요')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground" suppressHydrationWarning>
        {lastActivity
          ? `러너 마지막 활동 ${relativeTime(lastActivity.at)} · ${lastActivity.shortId} · ${KIND_LABELS[lastActivity.kind]}`
          : '러너 활동 기록 없음'}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={service} onValueChange={(v) => go({ service: v })}>
          <TabsList>
            <TabsTrigger value="all">
              전체 {countLabel(counts.web + counts.worker, counts.web >= 25 || counts.worker >= 25)}
            </TabsTrigger>
            <TabsTrigger value="web">웹 {countLabel(counts.web, counts.web >= 25)}</TabsTrigger>
            <TabsTrigger value="worker">
              워커 {countLabel(counts.worker, counts.worker >= 25)}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={status} onValueChange={(v) => go({ status: v })}>
          <SelectTrigger className="w-40" aria-label="자동 수정 상태">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">자동 수정: 전체</SelectItem>
            {(Object.keys(KIND_LABELS) as AutofixKind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <SortHead label="오류" k="title" sort={sort} dir={dir} onSort={onSort} />
            <SortHead label="서비스" k="service" sort={sort} dir={dir} onSort={onSort} />
            <SortHead
              label="발생"
              k="count"
              sort={sort}
              dir={dir}
              onSort={onSort}
              className="text-right"
            />
            <SortHead
              label="사용자"
              k="userCount"
              sort={sort}
              dir={dir}
              onSort={onSort}
              className="text-right"
            />
            <SortHead label="마지막" k="lastSeen" sort={sort} dir={dir} onSort={onSort} />
            <SortHead label="자동 수정" k="autofix" sort={sort} dir={dir} onSort={onSort} />
            <TableHead>동작</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                미해결 오류 없음
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((r) => {
              const kind = r.autofix.kind
              // 러너가 멈춰 until 이 지난 running 은 다시 조작할 수 있게 한다
              const stale =
                kind === 'running' && !!r.autofix.until && Date.parse(r.autofix.until) < Date.now()
              const busy = pendingId === r.id
              return (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => window.open(r.permalink, '_blank', 'noopener,noreferrer')}
                >
                  <TableCell className="max-w-md">
                    <a
                      href={r.permalink}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="block truncate font-medium hover:underline"
                    >
                      {r.title}
                    </a>
                    <div className="truncate text-xs text-muted-foreground">
                      {[r.culprit, r.shortId].filter(Boolean).join(' · ')}
                    </div>
                  </TableCell>
                  <TableCell>{r.service === 'web' ? '웹' : '워커'}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.userCount}</TableCell>
                  <TableCell className="whitespace-nowrap" suppressHydrationWarning>
                    {relativeTime(r.lastSeen)}
                  </TableCell>
                  <TableCell>
                    {kind === 'none' ? (
                      '—'
                    ) : kind === 'pr' && r.autofix.prUrl ? (
                      <a
                        href={r.autofix.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Badge variant="secondary">PR #{r.autofix.prUrl.split('/').pop()} ↗</Badge>
                      </a>
                    ) : (
                      <Badge variant={kind === 'failed' ? 'destructive' : 'secondary'}>
                        {stale ? '진행 중(만료)' : KIND_LABELS[kind]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {(kind !== 'running' || stale) && kind !== 'pr' && (
                      <div className="flex gap-2">
                        {kind !== 'request' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation()
                              void act(r, 'request')
                            }}
                          >
                            수정 요청
                          </Button>
                        )}
                        {kind !== 'skip' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation()
                              void act(r, 'skip')
                            }}
                          >
                            제외
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}
