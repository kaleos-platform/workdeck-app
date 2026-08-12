'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, PlusIcon } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ReorderPlanCreate } from '@/components/sh/inventory/reorder-plan-create'
import { ReorderMonitor, type MonitorData } from '@/components/sh/inventory/reorder-monitor'
import { Kpi, Panel, fmtQty } from '@/components/sh/inventory/reorder-ui'
import type { ReorderPlanSummary } from '@/components/sh/inventory/reorder-plan-types'

function StatusBadge({ status }: { status: ReorderPlanSummary['status'] }) {
  if (status === 'DRAFT') {
    return (
      <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700">
        초안
      </Badge>
    )
  }
  if (status === 'FINALIZED') {
    return (
      <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
        확정
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-gray-300 bg-gray-50 text-gray-600">
      소진
    </Badge>
  )
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

type PlanListResponse = {
  plans: ReorderPlanSummary[]
  latestAccuracy?: MonitorData
}

export default function ReorderPage() {
  const [plans, setPlans] = useState<ReorderPlanSummary[]>([])
  const [latestAccuracy, setLatestAccuracy] = useState<MonitorData>()
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [tab, setTab] = useState<'plans' | 'monitor'>('plans')
  // 모니터링 → 새 계획 시 위저드에 넘기는 추가 보정계수(자동 bias 보정 위에 곱해짐)
  const [createDemandAdjust, setCreateDemandAdjust] = useState<number | undefined>()

  const fetchPlans = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sh/inventory/reorder/plans')
      if (!res.ok) throw new Error('불러오기 실패')
      const data = (await res.json()) as PlanListResponse
      setPlans(data.plans)
      setLatestAccuracy(data.latestAccuracy)
    } catch (err) {
      console.error(err)
      toast.error('발주 계획 목록을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPlans()
  }, [fetchPlans])

  // 생성 모드: 상품 선택 → 외부 연동 → 자체 출고 → 수량 계산 → 세트 환산·검토
  if (creating) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">새 발주 계획</h1>
            <p className="text-sm text-muted-foreground">
              상품을 선택하고 옵션별 예측 수량을 확인한 뒤 발주 계획을 생성합니다
            </p>
          </div>
          <Button variant="outline" className="gap-1.5" onClick={() => setCreating(false)}>
            <ArrowLeft className="h-4 w-4" />
            계획 목록으로
          </Button>
        </div>
        <ReorderPlanCreate
          autoOpen
          onCancel={() => setCreating(false)}
          initialDemandAdjust={createDemandAdjust}
        />
      </div>
    )
  }

  const draftCount = plans.filter((p) => p.status === 'DRAFT').length
  const finalizedCount = plans.filter((p) => p.status === 'FINALIZED').length
  const finalQtySum = plans.reduce((s, p) => s + (p.totalFinalQty ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">발주 계획</h1>
          <p className="text-sm text-muted-foreground">
            진행한 발주 계획 이력을 확인하고 상품 단위로 새 계획을 생성합니다
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <PlusIcon className="h-4 w-4" />
          발주 계획 생성
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'plans' | 'monitor')}>
        <TabsList>
          <TabsTrigger value="plans">발주 계획</TabsTrigger>
          <TabsTrigger value="monitor">실적 모니터링</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'monitor' ? (
        <ReorderMonitor
          data={latestAccuracy}
          loading={loading}
          onApplyToNextPlan={(delta) => {
            setCreateDemandAdjust(delta)
            setCreating(true)
          }}
        />
      ) : (
        <div className="space-y-4">
          <Panel padded={false}>
            <div className="flex flex-wrap items-start gap-x-10 gap-y-4 px-5 py-4">
              <Kpi label="전체 계획 (최근 50건)" value={fmtQty(plans.length)} unit="건" />
              <Kpi label="초안" value={fmtQty(draftCount)} unit="건" />
              <Kpi label="검증 중" value={fmtQty(finalizedCount)} unit="건" />
              <Kpi label="최종수량 합계" value={fmtQty(finalQtySum)} unit="개" />
            </div>
          </Panel>

          <Panel padded={false}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>계획번호</TableHead>
                  <TableHead>상품</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="text-right">제안수량 합계</TableHead>
                  <TableHead className="text-right">최종수량 합계</TableHead>
                  <TableHead>생성일</TableHead>
                  <TableHead>확정일</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      불러오는 중...
                    </TableCell>
                  </TableRow>
                ) : plans.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      발주 계획이 없습니다. 위에서 새 계획을 생성해보세요.
                    </TableCell>
                  </TableRow>
                ) : (
                  plans.map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell className="font-mono text-sm font-medium">{plan.planNo}</TableCell>
                      <TableCell className="text-sm">
                        {plan.productName ?? <span className="text-muted-foreground">전체</span>}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={plan.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                        {fmtQty(plan.totalSuggestedQty)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium tabular-nums">
                        {plan.totalFinalQty ? fmtQty(plan.totalFinalQty) : '-'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(plan.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(plan.finalizedAt)}
                      </TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/d/seller-ops/inventory/reorder/plans/${plan.id}`}>
                            상세 보기
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Panel>
        </div>
      )}
    </div>
  )
}
