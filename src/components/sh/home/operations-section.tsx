'use client'

import { useEffect, useState } from 'react'
import { Link2, Factory } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SELLER_HUB_SETTINGS_INTEGRATION_PATH, SELLER_HUB_PRODUCTION_PATH } from '@/lib/deck-routes'
import { CardError, CardEmpty, CardListSkeleton, CardFooterLink } from './card-primitives'

// 운영 섹션 — 데이터 연동 + 생산 입고대기. operations-summary 1회 fetch 후
// 두 카드에 분배 (중복 호출 회피).

type OperationsSummary = {
  integration: {
    coupangLinked: boolean
    failedCollectionRuns: number
    failedBackfillJobs: number
    downWorkers: Array<{ service: string; lastPingAt: string }>
  }
  production: {
    pendingStockInCount: number
    samples: Array<{ runId: string; runNo: string; brandName: string | null; dueAt: string | null }>
  }
}

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: OperationsSummary }

export function OperationsSection() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    fetch('/api/sh/dashboard/operations-summary')
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((data: OperationsSummary) => setState({ kind: 'ready', data }))
      .catch(() => setState({ kind: 'error' }))
  }, [])

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <IntegrationStatusCard state={state} />
      <ProductionPendingCard state={state} />
    </div>
  )
}

function IntegrationStatusCard({ state }: { state: State }) {
  const integration = state.kind === 'ready' ? state.data.integration : null
  const failCount =
    (integration?.failedCollectionRuns ?? 0) + (integration?.failedBackfillJobs ?? 0)
  const downCount = integration?.downWorkers.length ?? 0
  const hasIssue = failCount > 0 || downCount > 0

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">데이터 연동</CardTitle>
        <Link2 className="h-4 w-4 text-muted-foreground" />
      </CardHeader>

      <CardContent className="pb-2">
        {state.kind === 'loading' ? (
          <CardListSkeleton rows={2} />
        ) : state.kind === 'error' || !integration ? (
          <CardError />
        ) : !integration.coupangLinked && downCount === 0 ? (
          <CardEmpty>연동된 자동 수집이 없습니다.</CardEmpty>
        ) : !hasIssue ? (
          <CardEmpty>자동 수집이 정상입니다.</CardEmpty>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-foreground">자동 수집 실패</span>
              <span
                className={`font-semibold tabular-nums ${
                  failCount > 0 ? 'text-destructive' : 'text-muted-foreground'
                }`}
              >
                {failCount.toLocaleString('ko-KR')}건
              </span>
            </div>
            {downCount > 0 && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-foreground">수집 워커 중단</span>
                <span className="font-semibold text-destructive tabular-nums">
                  {downCount.toLocaleString('ko-KR')}개
                </span>
              </div>
            )}
            <p className="border-t pt-2 text-xs text-muted-foreground">
              자동 수집이 실패한 기간은 과거 데이터를 수동으로 수집할 수 있습니다.
            </p>
          </div>
        )}
      </CardContent>

      <CardFooterLink href={SELLER_HUB_SETTINGS_INTEGRATION_PATH} label="데이터 연동" />
    </Card>
  )
}

function ProductionPendingCard({ state }: { state: State }) {
  const production = state.kind === 'ready' ? state.data.production : null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">생산 입고 대기</CardTitle>
        <Factory className="h-4 w-4 text-muted-foreground" />
      </CardHeader>

      <CardContent className="pb-2">
        {state.kind === 'loading' ? (
          <CardListSkeleton rows={3} />
        ) : state.kind === 'error' || !production ? (
          <CardError />
        ) : production.pendingStockInCount === 0 ? (
          <CardEmpty>입고 대기 중인 생산이 없습니다.</CardEmpty>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-foreground">발주완료·입고 미처리</span>
              <span className="font-semibold text-orange-500 tabular-nums">
                {production.pendingStockInCount.toLocaleString('ko-KR')}건
              </span>
            </div>
            <ul className="space-y-1 border-t pt-2" aria-label="입고 대기 생산 차수">
              {production.samples.map((s) => (
                <li
                  key={s.runId}
                  className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                >
                  <span className="truncate">
                    {s.runNo}
                    {s.brandName ? ` · ${s.brandName}` : ''}
                  </span>
                  {s.dueAt && (
                    <span className="shrink-0 tabular-nums">
                      {new Date(s.dueAt).toLocaleDateString('ko-KR', {
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                      납기
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <CardFooterLink href={SELLER_HUB_PRODUCTION_PATH} label="생산 관리" />
    </Card>
  )
}
