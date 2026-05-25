'use client'

import { TrendingDownIcon, TrendingUpIcon, AlertTriangleIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ReorderPlanAccuracy } from './reorder-plan-types'

type AggregatedAccuracy = {
  wape: number
  bias: number
  stockoutDays: number
  overstockDays: number
  optionCount: number
  planNo: string
  biasAdjustApplied: Record<string, number> | null
}

function aggregateAccuracy(
  accuracies: ReorderPlanAccuracy[],
  planNo: string,
  biasAdjustApplied: Record<string, number> | null
): AggregatedAccuracy | null {
  if (accuracies.length === 0) return null
  const wape = accuracies.reduce((sum, a) => sum + a.wape, 0) / accuracies.length
  const bias = accuracies.reduce((sum, a) => sum + a.bias, 0) / accuracies.length
  const stockoutDays = accuracies.reduce((sum, a) => sum + a.stockoutDays, 0)
  const overstockDays = accuracies.reduce((sum, a) => sum + a.overstockDays, 0)
  return {
    wape,
    bias,
    stockoutDays,
    overstockDays,
    optionCount: accuracies.length,
    planNo,
    biasAdjustApplied,
  }
}

function wapeBadgeVariant(wape: number) {
  if (wape < 0.2) return 'border-emerald-300 bg-emerald-50 text-emerald-700'
  if (wape < 0.4) return 'border-amber-300 bg-amber-50 text-amber-700'
  return 'border-red-300 bg-red-50 text-red-700'
}

type Props = {
  accuracies: ReorderPlanAccuracy[]
  planNo: string
  biasAdjustApplied: Record<string, number> | null
}

export function ReorderPlanAccuracyCard({ accuracies, planNo, biasAdjustApplied }: Props) {
  const agg = aggregateAccuracy(accuracies, planNo, biasAdjustApplied)
  if (!agg) return null

  const biasPercent = (agg.bias * 100).toFixed(1)
  const biasPositive = agg.bias > 0
  const adjustFactors = biasAdjustApplied ? Object.values(biasAdjustApplied) : []
  const avgFactor =
    adjustFactors.length > 0
      ? adjustFactors.reduce((s, v) => s + v, 0) / adjustFactors.length
      : null

  return (
    <Card className="border-muted bg-muted/20">
      <CardHeader className="pt-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <TrendingDownIcon className="h-4 w-4 text-muted-foreground" />
          직전 계획 적중률 — {agg.planNo}
          <span className="text-xs font-normal text-muted-foreground">
            ({agg.optionCount}개 옵션 평균)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="flex flex-wrap items-start gap-4">
          {/* WAPE */}
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">WAPE (주지표)</p>
            <Badge variant="outline" className={wapeBadgeVariant(agg.wape)}>
              {(agg.wape * 100).toFixed(1)}%
            </Badge>
          </div>

          {/* Bias */}
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Bias%</p>
            <div className="flex items-center gap-1">
              {biasPositive ? (
                <TrendingUpIcon className="h-3.5 w-3.5 text-amber-500" />
              ) : (
                <TrendingDownIcon className="h-3.5 w-3.5 text-blue-500" />
              )}
              <span className="text-sm font-medium tabular-nums">
                {biasPositive ? '+' : ''}
                {biasPercent}%
              </span>
              <span className="text-xs text-muted-foreground">
                ({biasPositive ? '과예측' : '과소예측'})
              </span>
            </div>
          </div>

          {/* 재고부족일 */}
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">재고부족 일수</p>
            <div className="flex items-center gap-1">
              {agg.stockoutDays > 0 && <AlertTriangleIcon className="h-3.5 w-3.5 text-red-500" />}
              <span className="text-sm tabular-nums">{agg.stockoutDays}일</span>
            </div>
          </div>

          {/* 과잉재고일 */}
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">과잉재고 일수</p>
            <span className="text-sm tabular-nums">{agg.overstockDays}일</span>
          </div>

          {/* 보정계수 안내 */}
          {avgFactor !== null && (
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">적용된 보정계수</p>
              <span className="text-sm font-medium tabular-nums">×{avgFactor.toFixed(3)}</span>
            </div>
          )}
        </div>

        {avgFactor !== null && (
          <p className="mt-3 text-xs text-muted-foreground">
            직전 계획의 Bias를 기반으로 이번 예측에 보정계수(×{avgFactor.toFixed(3)})가
            적용되었습니다.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
