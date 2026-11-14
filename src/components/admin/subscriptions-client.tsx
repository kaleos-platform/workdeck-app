'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const rows = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((row) => {
          const text = [
            row.spaceName,
            ...row.owners.flatMap((owner) => [owner.email, owner.name ?? '']),
          ]
            .join(' ')
            .toLowerCase()
          return (
            text.includes(search.trim().toLowerCase()) &&
            (deck === 'all' || row.deckAppId === deck) &&
            (status === 'all' || row.accessReason === status)
          )
        })
        .sort(
          (a, b) =>
            a.spaceName.localeCompare(b.spaceName, 'ko') ||
            a.deckName.localeCompare(b.deckName, 'ko')
        ),
    [data, search, deck, status]
  )
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
      <section className="space-y-3" aria-label="덱별 구독 현황">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Space·소유자 검색"
            placeholder="Space·소유자 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-64"
          />
          <select
            aria-label="덱 필터"
            value={deck}
            onChange={(e) => setDeck(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">전체 덱</option>
            {decks.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="상태 필터"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
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
            {rows.length}건 · 날짜 KST
          </span>
        </div>
        <div className="rounded-md border">
          <Table className="min-w-[1260px] table-fixed">
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="sticky left-0 z-20 w-[180px] bg-background">Space</TableHead>
                <TableHead className="w-[210px]">소유자</TableHead>
                <TableHead className="w-[130px]">덱</TableHead>
                <TableHead className="w-[110px]">이용 상태</TableHead>
                <TableHead className="w-[130px]">체험 종료일</TableHead>
                <TableHead className="w-[130px]">유료 이용 기한</TableHead>
                <TableHead className="w-[240px]">덱 면제</TableHead>
                <TableHead className="w-[130px]">체험 관리</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.spaceId}-${row.deckAppId}`}>
                  <TableCell className="sticky left-0 z-10 bg-background">
                    <Link
                      href={`/admin/billing/${row.spaceId}`}
                      className="block truncate font-medium hover:underline"
                      title={row.spaceName}
                    >
                      {row.spaceName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {row.owners.map((owner) => (
                      <Link
                        key={owner.id}
                        href={`/admin/users/${owner.id}`}
                        className="block truncate text-xs hover:underline"
                        title={`${owner.name ?? ''} ${owner.email}`}
                      >
                        {owner.email}
                      </Link>
                    ))}
                  </TableCell>
                  <TableCell>
                    <span className="block truncate" title={row.deckName}>
                      {row.deckName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.accessReason === 'LOCKED' ? 'destructive' : 'secondary'}>
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
                    (row.itemStatus === 'ACTIVE' || row.itemStatus === 'CANCEL_AT_PERIOD_END') &&
                    (row.subscriptionStatus === 'ACTIVE' || row.subscriptionStatus === 'PAST_DUE')
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
                      <span className="text-xs">{row.exemptFlag ? '덱 면제' : '덱 면제 없음'}</span>
                    </div>
                    {row.spaceExempt && (
                      <p className="mt-1 text-xs text-muted-foreground">전체 Space 면제 적용</p>
                    )}
                    {row.exemptNote && (
                      <p className="truncate text-xs text-muted-foreground" title={row.exemptNote}>
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
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    {data.rows.length
                      ? '검색 조건에 맞는 구독이 없습니다'
                      : '활성화된 덱이 없습니다. Space에서 덱을 활성화하면 표시됩니다.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
      <section className="space-y-3" aria-label="전체 Space 면제 관리">
        <h2 className="text-lg font-semibold">전체 Space 면제</h2>
        <p className="text-sm text-muted-foreground">
          모든 덱에 적용되는 기존 면제 설정입니다. 덱별 면제와 별도로 유지됩니다.
        </p>
        {data.spaces.length === 0 && (
          <p className="text-sm text-muted-foreground">관리할 Space가 없습니다.</p>
        )}
        <div className="divide-y rounded-md border">
          {data.spaces.map((space) => (
            <div key={space.id} className="flex items-center gap-3 px-3 py-2">
              <Link
                href={`/admin/billing/${space.id}`}
                className="min-w-0 flex-1 truncate text-sm hover:underline"
              >
                {space.name}
              </Link>
              <span
                className="hidden truncate text-xs text-muted-foreground sm:block"
                title={space.exemptNote ?? ''}
              >
                {space.exemptNote}
              </span>
              <Switch
                aria-label={`${space.name} 전체 Space 면제`}
                checked={space.exemptFlag}
                onCheckedChange={() => open({ kind: 'space', space })}
              />
            </div>
          ))}
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
