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
import { ReorderPlanAccuracyCard } from '@/components/sh/inventory/reorder-plan-accuracy-card'
import { ReorderPlanCreate } from '@/components/sh/inventory/reorder-plan-create'
import type {
  ReorderPlanAccuracy,
  ReorderPlanSummary,
} from '@/components/sh/inventory/reorder-plan-types'

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
  latestAccuracy?: {
    accuracies: ReorderPlanAccuracy[]
    planNo: string
    biasAdjustApplied: Record<string, number> | null
  }
}

export default function ReorderPage() {
  const [plans, setPlans] = useState<ReorderPlanSummary[]>([])
  const [latestAccuracy, setLatestAccuracy] = useState<PlanListResponse['latestAccuracy']>()
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

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

  // 생성 모드: 상품 선택 → 예측표 → 계획 생성
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
        <ReorderPlanCreate />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">발주 예측</h1>
          <p className="text-sm text-muted-foreground">
            진행한 발주 계획 이력을 확인하고 상품 단위로 새 계획을 생성합니다
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <PlusIcon className="h-4 w-4" />
          발주 계획 생성
        </Button>
      </div>

      {/* 직전 plan 적중률 카드 */}
      {latestAccuracy && latestAccuracy.accuracies.length > 0 && (
        <ReorderPlanAccuracyCard
          accuracies={latestAccuracy.accuracies}
          planNo={latestAccuracy.planNo}
          biasAdjustApplied={latestAccuracy.biasAdjustApplied}
        />
      )}

      {/* 목록 테이블 */}
      <div className="overflow-x-auto rounded-md border">
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
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : plans.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  발주 계획이 없습니다. 위에서 새 계획을 생성해보세요.
                </TableCell>
              </TableRow>
            ) : (
              plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell className="font-medium">{plan.planNo}</TableCell>
                  <TableCell className="text-sm">
                    {plan.productName ?? <span className="text-muted-foreground">전체</span>}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={plan.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {plan.totalSuggestedQty}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {plan.totalFinalQty || '-'}
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
      </div>
    </div>
  )
}
