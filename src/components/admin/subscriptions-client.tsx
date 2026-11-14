'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, CornerDownRight } from 'lucide-react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type {
  SubscriptionAccessRow,
  SubscriptionAccessOverview,
} from '@/lib/billing/subscription-admin-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

type Space = SubscriptionAccessOverview['spaces'][number]
type Change =
  | { kind: 'trial' | 'deck'; row: SubscriptionAccessRow }
  | { kind: 'space'; space: Space }
const labels: Record<SubscriptionAccessRow['accessReason'], string> = {
  FREE_BETA: '무료 제공',
  EXEMPT: '면제',
  SUBSCRIBED: '구독 중',
  TRIAL: '체험 중',
  GRACE: '유료화 유예',
  PAUSED: '결제 준비 중',
  LOCKED: '이용 제한',
}
const schema = z.object({
  note: z
    .string()
    .trim()
    .min(1, '변경 사유를 입력하세요')
    .max(500, '변경 사유는 500자 이내로 입력하세요'),
  trialEndsOn: z.string(),
})
type Values = z.infer<typeof schema>
function dateOnly(value: string | Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}
function trialDate(value: string) {
  return dateOnly(new Date(new Date(value).getTime() - 1))
}
function extendDate(value: string | null, days: number) {
  const base = value && value > dateOnly(new Date()) ? value : dateOnly(new Date())
  const date = new Date(`${base}T00:00:00+09:00`)
  date.setTime(date.getTime() + days * 86400000)
  return dateOnly(date)
}

export function SubscriptionsClient() {
  const [data, setData] = useState<SubscriptionAccessOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [deck, setDeck] = useState('all')
  const [status, setStatus] = useState('all')
  const [expandedSpaces, setExpandedSpaces] = useState<Record<string, boolean>>({})
  const [change, setChange] = useState<Change | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { note: '', trialEndsOn: '' },
  })
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/subscriptions')
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? '구독 현황을 불러오지 못했습니다')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : '구독 현황을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const hasFilters = Boolean(search.trim()) || deck !== 'all' || status !== 'all'
  const groups = useMemo(() => {
    const bySpace = new Map<string, SubscriptionAccessRow[]>()
    for (const row of data?.rows ?? []) {
      const rows = bySpace.get(row.spaceId) ?? []
      rows.push(row)
      bySpace.set(row.spaceId, rows)
    }
    const query = search.trim().toLowerCase()
    return (data?.spaces ?? [])
      .flatMap((space) => {
        const text = [
          space.name,
          ...space.owners.flatMap((owner) => [owner.email, owner.name ?? '']),
        ]
          .join(' ')
          .toLowerCase()
        if (!text.includes(query)) return []
        const allRows = bySpace.get(space.id) ?? []
        const rows = allRows
          .filter(
            (row) =>
              (deck === 'all' || row.deckAppId === deck) &&
              (status === 'all' || row.accessReason === status)
          )
          .sort((a, b) => a.deckName.localeCompare(b.deckName, 'ko'))
        // 업무·상태 조건이 없으면 업무 없는 Space도 검색·면제 관리 대상에 포함한다.
        if ((deck !== 'all' || status !== 'all') && rows.length === 0) return []
        return [{ space, rows, totalRows: allRows.length }]
      })
      .sort((a, b) => a.space.name.localeCompare(b.space.name, 'ko'))
  }, [data, search, deck, status])
  const visibleDeckCount = groups.reduce((sum, group) => sum + group.rows.length, 0)
  function open(target: Change) {
    form.reset({
      note: '',
      trialEndsOn:
        target.kind === 'trial'
          ? extendDate(target.row.trialEndsAt ? trialDate(target.row.trialEndsAt) : null, 7)
          : '',
    })
    setSaveError(null)
    setChange(target)
  }
  async function submit(values: Values) {
    if (!change) return
    if (change.kind === 'trial') {
      const current = change.row.trialEndsAt ? trialDate(change.row.trialEndsAt) : ''
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(values.trialEndsOn) ||
        values.trialEndsOn <= current ||
        values.trialEndsOn < dateOnly(new Date())
      ) {
        form.setError('trialEndsOn', {
          message: '현재 종료일보다 늦고 오늘 이후인 날짜를 선택하세요',
        })
        return
      }
    }
    setSaveError(null)
    try {
      const url =
        change.kind === 'space'
          ? `/api/admin/billing/spaces/${change.space.id}/exempt`
          : `/api/admin/subscriptions/${change.row.spaceId}/${change.row.deckAppId}`
      const body =
        change.kind === 'trial'
          ? { trialEndsOn: values.trialEndsOn, note: values.note }
          : {
              exempt: !(change.kind === 'space' ? change.space.exemptFlag : change.row.exemptFlag),
              note: values.note,
            }
      const res = await fetch(url, {
        method: change.kind === 'space' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? '변경에 실패했습니다')
      setChange(null)
      await load()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '변경에 실패했습니다')
    }
  }
  if (loading && !data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        구독 현황을 불러오는 중...
      </p>
    )
  if (!data)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <Button variant="outline" onClick={load}>
          다시 시도
        </Button>
      </div>
    )
  const decks = [...new Map(data.rows.map((row) => [row.deckAppId, row.deckName])).entries()]
  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button size="sm" variant="outline" onClick={load}>
            다시 시도
          </Button>
        </div>
      )}
      <section className="space-y-3" aria-label="Space·업무별 구독 현황">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Space·소유자 검색"
            placeholder="Space·소유자 검색"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setExpandedSpaces({})
            }}
            className="w-full sm:w-64"
          />
          <select
            aria-label="업무 필터"
            value={deck}
            onChange={(e) => {
              setDeck(e.target.value)
              setExpandedSpaces({})
            }}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">전체 업무</option>
            {decks.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="상태 필터"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setExpandedSpaces({})
            }}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">전체 상태</option>
            {Object.entries(labels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground tabular-nums">
            {groups.length}개 Space · {visibleDeckCount}개 업무
          </span>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <span className="text-xs text-muted-foreground">날짜 KST</span>
            <Button
              size="sm"
              variant="outline"
              disabled={groups.length === 0}
              onClick={() =>
                setExpandedSpaces(Object.fromEntries(groups.map(({ space }) => [space.id, true])))
              }
            >
              전체 펼치기
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={groups.length === 0}
              onClick={() =>
                setExpandedSpaces(Object.fromEntries(groups.map(({ space }) => [space.id, false])))
              }
            >
              전체 접기
            </Button>
            {hasFilters && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch('')
                  setDeck('all')
                  setStatus('all')
                  setExpandedSpaces({})
                }}
              >
                필터 초기화
              </Button>
            )}
          </div>
        </div>
        <div className="rounded-md border">
          <Table className="min-w-[1250px] table-fixed">
            <TableHeader className="sticky top-0 z-20 bg-background">
              <TableRow>
                <TableHead className="sticky left-0 z-30 w-[230px] bg-background">
                  Space / 업무
                </TableHead>
                <TableHead className="w-[220px]">소유자</TableHead>
                <TableHead className="w-[160px]">이용 상태</TableHead>
                <TableHead className="w-[130px]">체험 종료일</TableHead>
                <TableHead className="w-[130px]">유료 이용 기한</TableHead>
                <TableHead className="w-[240px]">면제</TableHead>
                <TableHead className="w-[140px]">체험 관리</TableHead>
              </TableRow>
            </TableHeader>
            {groups.map(({ space, rows, totalRows }) => {
              const expanded = rows.length > 0 && (expandedSpaces[space.id] ?? hasFilters)
              const summary = Object.entries(
                rows.reduce<Record<string, number>>((counts, row) => {
                  counts[row.accessReason] = (counts[row.accessReason] ?? 0) + 1
                  return counts
                }, {})
              )
                .map(
                  ([reason, count]) =>
                    `${labels[reason as SubscriptionAccessRow['accessReason']]} ${count}`
                )
                .join(' · ')
              return (
                <TableBody key={space.id} aria-label={`${space.name} 구독 현황`}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell className="sticky left-0 z-10 bg-muted">
                      <div className="flex min-w-0 items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 shrink-0"
                          disabled={rows.length === 0}
                          aria-label={`${space.name} 업무 ${expanded ? '접기' : '펼치기'}`}
                          aria-expanded={expanded}
                          aria-controls={
                            rows
                              .map((row) => `subscription-${space.id}-${row.deckAppId}`)
                              .join(' ') || undefined
                          }
                          onClick={() =>
                            setExpandedSpaces((prev) => ({ ...prev, [space.id]: !expanded }))
                          }
                        >
                          {expanded ? (
                            <ChevronDown className="size-4" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="size-4" aria-hidden="true" />
                          )}
                        </Button>
                        <Link
                          href={`/admin/billing/${space.id}`}
                          className="min-w-0 truncate font-medium hover:underline"
                          title={space.name}
                        >
                          {space.name}
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell>
                      {space.owners.length ? (
                        space.owners.map((owner) => (
                          <Link
                            key={owner.id}
                            href={`/admin/users/${owner.id}`}
                            className="block truncate text-xs hover:underline"
                            title={`${owner.name ?? ''} ${owner.email}`}
                          >
                            {owner.email}
                          </Link>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">소유자 없음</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="text-xs font-medium">
                        {totalRows === 0
                          ? '업무 없음'
                          : rows.length === totalRows
                            ? `${totalRows}개 업무`
                            : `${totalRows}개 중 ${rows.length}개 표시`}
                      </p>
                      {summary && (
                        <p className="mt-1 text-xs whitespace-normal text-muted-foreground">
                          {summary}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">—</TableCell>
                    <TableCell className="text-xs text-muted-foreground">—</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          aria-label={`${space.name} 전체 Space 면제`}
                          checked={space.exemptFlag}
                          onCheckedChange={() => open({ kind: 'space', space })}
                        />
                        <span className="text-xs font-medium">전체 업무 면제</span>
                      </div>
                      {space.exemptNote && (
                        <p
                          className="mt-1 truncate text-xs text-muted-foreground"
                          title={space.exemptNote}
                        >
                          {space.exemptNote}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">—</TableCell>
                  </TableRow>
                  {rows.map((row) => (
                    <TableRow
                      key={row.deckAppId}
                      id={`subscription-${space.id}-${row.deckAppId}`}
                      hidden={!expanded}
                    >
                      <TableCell className="sticky left-0 z-10 bg-background">
                        <div className="flex min-w-0 items-center gap-2 pl-8">
                          <CornerDownRight
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span className="truncate" title={row.deckName}>
                            {row.deckName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="sr-only">소유자는 Space 행 참조</span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={row.accessReason === 'LOCKED' ? 'destructive' : 'secondary'}
                        >
                          {labels[row.accessReason]}
                        </Badge>
                        {row.subscriptionStatus === 'PAST_DUE' && (
                          <p className="mt-1 text-xs text-destructive">결제 연체</p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {row.trialEndsAt ? trialDate(row.trialEndsAt) : '미시작'}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {row.currentPeriodEnd &&
                        !row.exemptFlag &&
                        !row.spaceExempt &&
                        (row.itemStatus === 'ACTIVE' ||
                          row.itemStatus === 'CANCEL_AT_PERIOD_END') &&
                        (row.subscriptionStatus === 'ACTIVE' ||
                          row.subscriptionStatus === 'PAST_DUE')
                          ? dateOnly(row.currentPeriodEnd)
                          : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            aria-label={`${row.spaceName} ${row.deckName} 덱 면제`}
                            checked={row.exemptFlag}
                            onCheckedChange={() => open({ kind: 'deck', row })}
                          />
                          <span className="text-xs">
                            {row.exemptFlag ? '덱 면제' : '덱 면제 없음'}
                          </span>
                        </div>
                        {row.spaceExempt && (
                          <p className="mt-1 text-xs text-muted-foreground">전체 Space 면제 적용</p>
                        )}
                        {row.exemptNote && (
                          <p
                            className="truncate text-xs text-muted-foreground"
                            title={row.exemptNote}
                          >
                            {row.exemptNote}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.canExtendTrial ? (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`${row.deckName} 체험 연장`}
                            onClick={() => open({ kind: 'trial', row })}
                          >
                            체험 연장
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              )
            })}
            {groups.length === 0 && (
              <TableBody>
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    {data.spaces.length
                      ? '검색 조건에 맞는 구독이 없습니다'
                      : '등록된 Space가 없습니다. Space를 생성하면 이곳에서 구독을 관리할 수 있습니다.'}
                  </TableCell>
                </TableRow>
              </TableBody>
            )}
          </Table>
        </div>
      </section>
      <Dialog
        open={!!change}
        onOpenChange={(value) => {
          if (!value && !form.formState.isSubmitting) setChange(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {change?.kind === 'trial'
                ? '체험 종료일 연장'
                : change?.kind === 'space'
                  ? '전체 Space 면제 변경'
                  : '덱 면제 변경'}
            </DialogTitle>
            <DialogDescription>
              {change?.kind === 'space'
                ? change.space.name
                : change
                  ? `${change.row.spaceName} · ${change.row.deckName}`
                  : ''}{' '}
              · 변경 사유는 감사 로그에 기록됩니다.
              {change &&
                change.kind !== 'trial' &&
                ` ${
                  (change.kind === 'space' ? change.space.exemptFlag : change.row.exemptFlag)
                    ? '면제를 해제합니다.'
                    : '면제를 설정합니다.'
                }`}
              {change?.kind === 'space' &&
                ' 필터와 관계없이 이 Space의 모든 업무에 적용됩니다. 개별 업무 면제 설정은 유지됩니다.'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
              {change?.kind === 'trial' && (
                <>
                  <FormField
                    control={form.control}
                    name="trialEndsOn"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>체험 종료일 (KST)</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex gap-2">
                    {[7, 30].map((days) => (
                      <Button
                        key={days}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          form.setValue(
                            'trialEndsOn',
                            extendDate(
                              change.row.trialEndsAt ? trialDate(change.row.trialEndsAt) : null,
                              days
                            )
                          )
                        }
                      >
                        +{days}일
                      </Button>
                    ))}
                  </div>
                </>
              )}
              <p className="text-sm text-muted-foreground">
                {change?.kind === 'trial'
                  ? '체험 연장은 자동 결제를 시작하지 않습니다. 이용자가 직접 유료 구독을 시작해야 합니다.'
                  : '면제를 해제해도 자동으로 유료 구독을 시작하지 않습니다. 전체 Space 면제가 켜져 있으면 덱 면제 해제 후에도 면제가 유지됩니다.'}
              </p>
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>변경 사유</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {saveError && (
                <p role="alert" className="text-sm text-destructive">
                  {saveError}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={form.formState.isSubmitting}
                  onClick={() => setChange(null)}
                >
                  취소
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? '저장 중...' : '저장'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
