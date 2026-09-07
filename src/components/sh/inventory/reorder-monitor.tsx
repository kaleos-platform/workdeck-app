'use client'

// 실적 모니터링 — 직전 CONSUMED 계획의 예측 검증 결과.
//
// 지표 기준 주의: ReorderPlanAccuracy가 가진 쌍은 "리드타임 구간의 예측 출고 vs 실 출고"다.
// (forecastOutbound = dailyAvgForecast × leadTimeDays, actualOutbound = 해당 구간 실출고)
// 발주 수량(totalFinalQty)과는 기준이 다르므로 두 값을 나누거나 섞어 표시하지 않는다.

import { ActivityIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Bar, Kpi, Panel, fmtPctSigned, fmtQty } from './reorder-ui'

export type MonitorAccuracy = {
  optionId: string
  optionName: string | null
  sku: string | null
  wape: number
  bias: number
  stockoutDays: number
  overstockDays: number
  actualOutbound: number
  forecastOutbound: number
}

export type MonitorData = {
  planNo: string
  biasAdjustApplied: Record<string, number> | null
  accuracies: MonitorAccuracy[]
}

// 판정 밴드 — ReorderPlanAccuracyCard와 동일한 WAPE 기준을 재사용한다.
// (프로토타입의 8% 기준을 새로 도입하면 "정확"의 정의가 둘이 된다)
function verdict(wape: number, bias: number) {
  if (wape < 0.2) {
    return { label: '정확', className: 'border-emerald-300 bg-emerald-50 text-emerald-700' }
  }
  if (wape < 0.4) {
    return {
      label: bias > 0 ? '과예측' : '과소예측',
      className: 'border-amber-300 bg-amber-50 text-amber-700',
    }
  }
  return {
    label: bias > 0 ? '과다 발주' : '부족',
    className: 'border-red-300 bg-red-50 text-red-700',
  }
}

type Props = {
  data?: MonitorData
  loading?: boolean
  /**
   * "다음 계획에 반영" — 생성 위저드로 이동한다.
   * delta는 자동 bias 보정 위에 곱해지는 추가 계수라 기본 1(추가 보정 없음)로 넘기고,
   * 실제 값 조정은 위저드 4단계 슬라이더에서 사용자가 한다. 여기서 측정 오차를 그대로
   * 넘기면 자동 보정과 이중 계산이 된다.
   */
  onApplyToNextPlan?: (demandAdjustDelta: number) => void
}

export function ReorderMonitor({ data, loading, onApplyToNextPlan }: Props) {
  if (loading) {
    return (
      <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">
        실적을 불러오는 중...
      </div>
    )
  }

  if (!data || data.accuracies.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 py-16 text-center text-sm text-muted-foreground">
        아직 측정된 실적이 없습니다. 계획의 &lsquo;예측 검증 시작&rsquo; 후 리드타임 기간의 실판매가
        누적되면 여기에 표시됩니다.
      </div>
    )
  }

  const rows = data.accuracies
  const forecastTotal = rows.reduce((s, r) => s + r.forecastOutbound, 0)
  const actualTotal = rows.reduce((s, r) => s + r.actualOutbound, 0)
  const totalErr = forecastTotal > 0 ? (actualTotal - forecastTotal) / forecastTotal : 0
  const accurateCount = rows.filter((r) => r.wape < 0.2).length

  // 자동 bias 보정 — 다음 계획 생성 시 서버가 이미 적용하는 계수(읽기 전용 노출).
  const autoFactors = data.biasAdjustApplied ? Object.values(data.biasAdjustApplied) : []
  const autoFactor =
    autoFactors.length > 0 ? autoFactors.reduce((s, v) => s + v, 0) / autoFactors.length : null

  return (
    <div className="space-y-4">
      <Panel
        title={
          <span className="flex items-center gap-2">
            <ActivityIcon className="h-4 w-4 text-muted-foreground" />
            직전 계획 {data.planNo} 예측 검증 결과
          </span>
        }
        desc="리드타임 구간의 예측 출고와 실제 출고를 비교한 값입니다 (발주 수량 대비가 아닙니다)"
        right={
          onApplyToNextPlan && (
            <Button size="sm" variant="outline" onClick={() => onApplyToNextPlan(1)}>
              이 실적으로 새 계획 만들기
            </Button>
          )
        }
      >
        <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
          <Kpi label="예측 출고" value={fmtQty(forecastTotal)} unit="개" size="lg" />
          <Kpi label="실 출고" value={fmtQty(actualTotal)} unit="개" size="lg" />
          <Kpi
            label="전체 오차"
            value={fmtPctSigned(totalErr)}
            size="lg"
            sub="실 출고 − 예측 출고"
            valueClassName={
              Math.abs(totalErr) < 0.2
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-400'
            }
          />
          <Kpi
            label="정확 판정 옵션"
            value={`${accurateCount}/${rows.length}`}
            size="lg"
            sub="WAPE 20% 미만"
          />
          {autoFactor !== null && (
            <Kpi
              label="자동 보정계수"
              value={`×${autoFactor.toFixed(3)}`}
              size="lg"
              sub="다음 계획에 자동 적용됨"
            />
          )}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          {autoFactor !== null ? (
            <>
              이 Bias 보정(×{autoFactor.toFixed(3)})은 다음 계획 생성 시 서버가 <b>자동으로</b>{' '}
              적용합니다. 위저드 &lsquo;수량 계산&rsquo; 단계의 보정계수는 그 위에 <b>곱해지는</b>{' '}
              추가 계수이므로, 자동 보정값을 그대로 다시 입력하면 이중 보정이 됩니다.
            </>
          ) : (
            <>옵션별 안전재고 권장값은 계획 상세의 안전재고 컬럼에서 확인·적용할 수 있습니다.</>
          )}
        </p>
      </Panel>

      <Panel
        title="옵션별 예측 출고 vs 실 출고"
        desc="오차가 큰 옵션이 다음 계획의 보정 근거가 됩니다"
        padded={false}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>옵션</TableHead>
              <TableHead className="text-right">예측 출고</TableHead>
              <TableHead className="text-right">실 출고</TableHead>
              <TableHead className="text-right">WAPE</TableHead>
              <TableHead className="text-right">Bias</TableHead>
              <TableHead className="w-[220px]">비교</TableHead>
              <TableHead className="text-right">재고부족 / 과잉</TableHead>
              <TableHead>판정</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const max = Math.max(r.forecastOutbound, r.actualOutbound, 1)
              const v = verdict(r.wape, r.bias)
              return (
                <TableRow key={r.optionId}>
                  <TableCell className="text-sm">
                    {r.optionName ?? r.optionId}
                    {r.sku && (
                      <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                        {r.sku}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                    {fmtQty(r.forecastOutbound)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtQty(r.actualOutbound)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {(r.wape * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtPctSigned(r.bias)}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Bar value={r.forecastOutbound} max={max} tone="bg-muted-foreground" />
                      <Bar value={r.actualOutbound} max={max} tone="bg-foreground" />
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                    {r.stockoutDays}일 / {r.overstockDays}일
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={v.className}>
                      {v.label}
                    </Badge>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Panel>
    </div>
  )
}
