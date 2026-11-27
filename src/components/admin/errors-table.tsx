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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
import {
  analysisIssueUrl,
  CATEGORY_LABELS,
  isApprovable,
  isUntilPassed,
  STAGE_LABELS,
  triageReason,
  type AutofixKind,
  type AutofixState,
  type Stage,
  type Triage,
} from '@/lib/sentry/autofix-status'

export type ErrorRow = {
  id: string
  shortId: string
  title: string
  culprit: string
  permalink: string
  count: number
  userCount: number
  firstSeen: string
  lastSeen: string
  service: 'web' | 'worker'
  autofix: AutofixState
  triage: Triage | null
  stage: Stage
}

export type Summary = {
  total: number
  approval: number
  confirm: number
  ignore: number
  p1: number
}

type Props = {
  rows: ErrorRow[]
  service: 'all' | 'web' | 'worker'
  stage: Stage | 'all'
  priority?: 'P1'
  summary: Summary
  counts: { web: number; worker: number }
  lastActivity: { at: string; shortId: string; kind: AutofixKind } | null
}

type Action = 'request' | 'skip' | 'approve' | 'analyze'

const KIND_LABELS: Record<AutofixKind, string> = {
  none: '없음',
  request: '요청됨',
  running: '진행 중',
  pr: 'PR',
  analysis: '분석만',
  failed: '실패',
  skip: '제외',
  ready: '승인 대기',
  approve: '승인됨',
  'analyze-request': '분석 요청됨',
  analyzing: '분석 중',
  analyzed: '분석 완료',
  'analyze-failed': '분석 실패',
}

const VERDICT_LABELS = { fix: '고칠 것', watch: '지켜볼 것', ignore: '무시' } as const
const CONF_LABELS = { high: '높음', mid: '중간', low: '낮음' } as const

const PRIORITY_LABELS = { P1: 'P1 높음', P2: 'P2 중간', P3: 'P3 낮음' } as const
const PRIORITY_CLASS = {
  P1: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  P2: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400',
  P3: '',
} as const
const ACT_LABELS = { fix: '자동 수정', confirm: '확인 필요', ignore: '제외' } as const

function relativeTime(iso: string) {
  const sec = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (sec < 60) return '방금 전'
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`
  return `${Math.floor(sec / 86400)}일 전`
}

type SortKey = 'priority' | 'title' | 'service' | 'count' | 'userCount' | 'lastSeen' | 'stage'
type SortDir = 'asc' | 'desc'

const SORT_VALUE: Record<SortKey, (r: ErrorRow) => string | number> = {
  priority: (r) => (r.triage ? Number(r.triage.p.slice(1)) : 4),
  title: (r) => r.title,
  service: (r) => r.service,
  count: (r) => r.count,
  userCount: (r) => r.userCount,
  lastSeen: (r) => Date.parse(r.lastSeen) || 0,
  stage: (r) => STAGE_LABELS[r.stage],
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

function PriorityBadge({ triage }: { triage: Triage | null }) {
  if (!triage) return <Badge variant="outline">판단 전</Badge>
  return (
    <Badge
      variant={triage.p === 'P3' ? 'secondary' : 'outline'}
      className={PRIORITY_CLASS[triage.p]}
    >
      {PRIORITY_LABELS[triage.p]}
    </Badge>
  )
}

// 러너가 멈춰 until 이 지난 running · analyzing 은 다시 조작할 수 있게 한다
const isStale = (r: ErrorRow) =>
  (r.autofix.kind === 'running' || r.autofix.kind === 'analyzing') && isUntilPassed(r.autofix)

function actionsFor(r: ErrorRow, inSheet = false): { action: Action; label: string }[] {
  const request = { action: 'request' as const, label: '수정 요청' }
  const skip = { action: 'skip' as const, label: '제외' }
  const analyze = { action: 'analyze' as const, label: '분석 요청' }
  const retry = { action: 'analyze' as const, label: '다시 요청' }
  switch (r.stage) {
    case 'confirm':
      return inSheet ? [analyze, request, skip] : [analyze, skip]
    case 'analyze-requested':
      return [skip]
    case 'analyzing':
      return isStale(r) ? [retry] : []
    case 'analyze-failed':
      return [retry, skip]
    case 'analyzed':
      return r.autofix.verdict === 'fix'
        ? [request, skip]
        : r.autofix.verdict === 'ignore'
          ? [{ action: 'skip', label: '제외 확정' }]
          : [skip]
    case 'approval':
      return isApprovable(r.autofix)
        ? [{ action: 'approve', label: 'PR 올리기' }, skip]
        : [request, skip]
    case 'ignore-suggested':
      return [{ action: 'skip', label: '제외 확정' }, request]
    case 'approved':
    case 'pr':
      return []
    case 'running':
      return isStale(r) ? [request, skip] : []
    case 'requested':
      return [skip]
    case 'skipped':
      return [request]
    default:
      return [request, skip]
  }
}

function ActionButtons({
  row,
  busy,
  onAct,
  inSheet,
}: {
  row: ErrorRow
  busy: boolean
  onAct: (row: ErrorRow, action: Action) => void
  inSheet?: boolean
}) {
  const list = actionsFor(row, inSheet)
  if (list.length === 0) return null
  return (
    <div className="flex gap-2">
      {list.map((a) => (
        <Button
          key={a.action}
          size="sm"
          variant={a.action === 'approve' ? 'default' : 'outline'}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            onAct(row, a.action)
          }}
        >
          {a.label}
        </Button>
      ))}
    </div>
  )
}

// 조회 상한(25)에 걸린 목록이 있으면 + 를 붙인다
const countLabel = (n: number, capped: boolean) => `${n}${capped ? '+' : ''}`

export function ErrorsTable({
  rows,
  service,
  stage,
  priority,
  summary,
  counts,
  lastActivity,
}: Props) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  // null = 서버 순서(우선순위 → 사용자 많은 순 → 발생 많은 순)
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

  // stage·priority 는 null 로 넘기면 해제, 생략하면 유지
  function go(next: { service?: string; stage?: string | null; priority?: string | null }) {
    const params = new URLSearchParams()
    const s = next.service ?? service
    const st = next.stage === undefined ? stage : (next.stage ?? 'all')
    const pr = next.priority === undefined ? priority : next.priority
    if (s !== 'all') params.set('service', s)
    if (st !== 'all') params.set('stage', st)
    if (pr) params.set('priority', pr)
    const qs = params.toString()
    router.push(qs ? `/admin/errors?${qs}` : '/admin/errors')
  }

  async function act(row: ErrorRow, action: Action) {
    setPendingId(row.id)
    try {
      const res = await fetchWithMfa(`/api/admin/errors/${row.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'approve' ? { action, id: row.autofix.id, sha: row.autofix.sha } : { action }
        ),
      })
      if (await redirectIfMfaRequired(res)) return
      if (res.status === 409) {
        toast.error('수정안이 바뀌었습니다. 새로고침 후 다시 확인하세요')
        return
      }
      if (!res.ok) {
        toast.error('처리하지 못했습니다. 잠시 후 다시 시도해 주세요')
        return
      }
      toast.success(
        action === 'request'
          ? '수정을 요청했습니다'
          : action === 'analyze'
            ? '분석을 요청했습니다'
            : action === 'approve'
              ? 'PR 올리기를 승인했습니다'
              : '제외했습니다'
      )
      setOpenId(null)
      router.refresh()
    } catch {
      toast.error('처리하지 못했습니다. 잠시 후 다시 시도해 주세요')
    } finally {
      setPendingId(null)
    }
  }

  const chips: { label: string; n: number; active: boolean; onClick: () => void }[] = [
    {
      label: '전체',
      n: summary.total,
      active: stage === 'all' && !priority,
      onClick: () => go({ stage: null, priority: null }),
    },
    {
      label: '승인 대기',
      n: summary.approval,
      active: stage === 'approval',
      onClick: () => go({ stage: 'approval', priority: null }),
    },
    {
      label: '확인 필요',
      n: summary.confirm,
      active: stage === 'confirm',
      onClick: () => go({ stage: 'confirm', priority: null }),
    },
    {
      label: '제외 제안',
      n: summary.ignore,
      active: stage === 'ignore-suggested',
      onClick: () => go({ stage: 'ignore-suggested', priority: null }),
    },
    {
      label: 'P1',
      n: summary.p1,
      active: priority === 'P1',
      onClick: () => go({ stage: null, priority: 'P1' }),
    },
  ]

  const open = rows.find((r) => r.id === openId) ?? null
  const fix =
    open && (open.autofix.kind === 'ready' || open.autofix.kind === 'approve') ? open : null

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground" suppressHydrationWarning>
        {lastActivity
          ? `러너 마지막 활동 ${relativeTime(lastActivity.at)} · ${lastActivity.shortId} · ${KIND_LABELS[lastActivity.kind]}`
          : '러너 활동 기록 없음'}
      </p>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <Button
            key={c.label}
            type="button"
            size="sm"
            variant={c.active ? 'default' : 'outline'}
            aria-pressed={c.active}
            onClick={c.onClick}
          >
            {c.label} {c.n}
          </Button>
        ))}
      </div>
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
        <Select value={stage} onValueChange={(v) => go({ stage: v })}>
          <SelectTrigger className="w-40" aria-label="처리 단계">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">처리 단계: 전체</SelectItem>
            {(Object.keys(STAGE_LABELS) as Stage[]).map((k) => (
              <SelectItem key={k} value={k}>
                {STAGE_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <SortHead label="우선순위" k="priority" sort={sort} dir={dir} onSort={onSort} />
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
            <SortHead label="처리 단계" k="stage" sort={sort} dir={dir} onSort={onSort} />
            <TableHead>동작</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                미해결 오류 없음
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((r) => {
              const stale = isStale(r)
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                  <TableCell>
                    <PriorityBadge triage={r.triage} />
                  </TableCell>
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
                    {r.triage && (
                      <div className="truncate text-xs text-muted-foreground">
                        {triageReason(r.triage, r)}
                      </div>
                    )}
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
                    {r.stage === 'pr' && r.autofix.prUrl ? (
                      <a
                        href={r.autofix.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Badge variant="secondary">PR #{r.autofix.prUrl.split('/').pop()} ↗</Badge>
                      </a>
                    ) : r.stage === 'analyzed' && r.autofix.issueNumber ? (
                      <a
                        href={analysisIssueUrl(r.autofix.issueNumber)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Badge variant="secondary">
                          {VERDICT_LABELS[r.autofix.verdict ?? 'watch']} · 이슈 #
                          {r.autofix.issueNumber} ↗
                        </Badge>
                      </a>
                    ) : r.stage === 'unjudged' ? (
                      '—'
                    ) : (
                      <Badge
                        variant={r.stage === 'failed' ? 'destructive' : 'secondary'}
                        className={
                          r.stage === 'approval'
                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                            : undefined
                        }
                      >
                        {stale
                          ? r.stage === 'analyzing'
                            ? '분석 중(만료)'
                            : '진행 중(만료)'
                          : r.stage === 'approval' && !isApprovable(r.autofix)
                            ? '검증 실패'
                            : STAGE_LABELS[r.stage]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <ActionButtons row={r} busy={pendingId === r.id} onAct={act} />
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>{open.title}</SheetTitle>
                <SheetDescription>
                  {[open.shortId, open.culprit].filter(Boolean).join(' · ')}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-5 px-4 pb-4 text-sm">
                <a
                  href={open.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  Sentry에서 보기 ↗
                </a>
                <section className="flex flex-col gap-2">
                  <h3 className="font-semibold">AI 판단</h3>
                  {open.triage ? (
                    <dl className="grid grid-cols-[4rem_1fr] gap-y-1.5">
                      <dt className="text-muted-foreground">우선순위</dt>
                      <dd>
                        <PriorityBadge triage={open.triage} />
                      </dd>
                      <dt className="text-muted-foreground">유형</dt>
                      <dd>{CATEGORY_LABELS[open.triage.cat]}</dd>
                      <dt className="text-muted-foreground">근거</dt>
                      <dd>{triageReason(open.triage, open)}</dd>
                      <dt className="text-muted-foreground">제안</dt>
                      <dd>{ACT_LABELS[open.triage.act]}</dd>
                      <dt className="text-muted-foreground">판단 시각</dt>
                      <dd suppressHydrationWarning>{relativeTime(open.triage.at)}</dd>
                    </dl>
                  ) : (
                    <p className="text-muted-foreground">아직 판단 전</p>
                  )}
                </section>
                {fix && (
                  <section className="flex flex-col gap-2">
                    <h3 className="font-semibold">수정안</h3>
                    <dl className="grid grid-cols-[4rem_1fr] gap-y-1.5">
                      <dt className="text-muted-foreground">변경</dt>
                      <dd>
                        {fix.autofix.files}개 파일 · {fix.autofix.lines}줄
                      </dd>
                      <dt className="text-muted-foreground">검증</dt>
                      <dd>{fix.autofix.verify === 'ok' ? '통과' : '실패'}</dd>
                      <dt className="text-muted-foreground">AI 리뷰</dt>
                      <dd>{fix.autofix.review ?? '—'}</dd>
                      <dt className="text-muted-foreground">id</dt>
                      <dd className="font-mono text-xs break-all">{fix.autofix.id}</dd>
                    </dl>
                    <p className="text-xs text-muted-foreground">코드는 PR에서 검토합니다</p>
                  </section>
                )}
                {open.autofix.kind === 'analyzed' && open.autofix.issueNumber && (
                  <section className="flex flex-col gap-2">
                    <h3 className="font-semibold">분석</h3>
                    <dl className="grid grid-cols-[4rem_1fr] gap-y-1.5">
                      <dt className="text-muted-foreground">판정</dt>
                      <dd>{VERDICT_LABELS[open.autofix.verdict ?? 'watch']}</dd>
                      <dt className="text-muted-foreground">확신도</dt>
                      <dd>{CONF_LABELS[open.autofix.conf ?? 'low']}</dd>
                      <dt className="text-muted-foreground">자동 수정</dt>
                      <dd>{open.autofix.auto === 'yes' ? '가능' : '불가'}</dd>
                      <dt className="text-muted-foreground">결과</dt>
                      <dd>
                        <a
                          href={analysisIssueUrl(open.autofix.issueNumber)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          이슈 #{open.autofix.issueNumber} ↗
                        </a>
                      </dd>
                      <dt className="text-muted-foreground">시각</dt>
                      <dd suppressHydrationWarning>
                        {open.autofix.at ? relativeTime(open.autofix.at) : '—'}
                      </dd>
                    </dl>
                  </section>
                )}
                <ActionButtons row={open} busy={pendingId === open.id} onAct={act} inSheet />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
