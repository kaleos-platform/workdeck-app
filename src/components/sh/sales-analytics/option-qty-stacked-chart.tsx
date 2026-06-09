'use client'

import { useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  OTHER_OPTION_ID,
  optionBucketValue,
  resolveDisplayOptions,
  type OptionBucket,
} from '@/lib/sh/sales-analytics'

type Props = {
  buckets: OptionBucket[]
  nameById: Map<string, string>
  /** 시리즈로 노출할 상위 옵션 수 (나머지는 "기타") */
  topN?: number
  loading: boolean
}

type ChartRow = { label: string; [optionId: string]: string | number }

export function OptionQtyStackedChart({ buckets, nameById, topN = 10, loading }: Props) {
  // 표시 옵션 (상위 N + 기타) — 데이터 기반. 색상 단일 소스.
  const displayOptions = useMemo(
    () => resolveDisplayOptions(buckets, nameById, topN),
    [buckets, nameById, topN]
  )

  // "기타" 합산 시 제외할 실제 상위 옵션 id 집합
  const topOptionIds = useMemo(
    () => new Set(displayOptions.filter((o) => o.id !== OTHER_OPTION_ID).map((o) => o.id)),
    [displayOptions]
  )

  // 제외(체크 해제) 옵션만 추적 — 기본은 전체 선택(없으면 표시). 표시 옵션이 바뀌어도
  // effect 동기화가 불필요하다(부재=선택). 데이터 교체 시 자연히 전체 선택으로 회귀.
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set())

  const isSelected = (id: string) => !deselectedIds.has(id)

  const visibleOptions = useMemo(
    () => displayOptions.filter((o) => isSelected(o.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayOptions, deselectedIds]
  )

  const chartData = useMemo<ChartRow[]>(() => {
    return buckets.map((b) => {
      const row: ChartRow = { label: b.label }
      for (const o of visibleOptions) {
        row[o.id] = optionBucketValue(b, o.id, topOptionIds)
      }
      return row
    })
  }, [buckets, visibleOptions, topOptionIds])

  const nameByKey = useMemo(() => {
    const m = new Map<string, string>()
    displayOptions.forEach((o) => m.set(o.id, o.name))
    return m
  }, [displayOptions])

  function toggleOption(id: string) {
    setDeselectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    // 전체 선택 상태면 모두 해제, 아니면 모두 선택(해제 집합 비움)
    setDeselectedIds(allSelected ? new Set(displayOptions.map((o) => o.id)) : new Set())
  }

  const allSelected = displayOptions.length > 0 && displayOptions.every((o) => isSelected(o.id))

  return (
    <Card>
      <CardHeader>
        <CardTitle>상품(옵션)별 판매량 추이</CardTitle>
        {/* 옵션 선택/제외 + 전체 (상위 N + 기타) */}
        {displayOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <div className="flex items-center gap-1.5">
              <Checkbox id="oq-opt-all" checked={allSelected} onCheckedChange={toggleAll} />
              <Label htmlFor="oq-opt-all" className="cursor-pointer text-xs font-medium">
                전체
              </Label>
            </div>
            {displayOptions.map((o) => (
              <div key={o.id} className="flex items-center gap-1.5">
                <Checkbox
                  id={`oq-opt-${o.id}`}
                  checked={isSelected(o.id)}
                  onCheckedChange={() => toggleOption(o.id)}
                />
                <Label
                  htmlFor={`oq-opt-${o.id}`}
                  className="max-w-[16rem] cursor-pointer truncate text-xs"
                  style={{ color: o.color }}
                  title={o.name}
                >
                  {o.name}
                </Label>
              </div>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            불러오는 중...
          </div>
        ) : chartData.length === 0 || visibleOptions.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            {displayOptions.length > 0 && visibleOptions.length === 0
              ? '표시할 옵션을 선택하세요'
              : '해당 기간에 판매량 데이터가 없습니다'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => Number(v).toLocaleString('ko-KR')}
              />
              <Tooltip
                formatter={
                  ((value: number | string | undefined, name: string | number | undefined) => {
                    const num = typeof value === 'number' ? value : Number(value ?? 0)
                    const key = String(name ?? '')
                    const display = nameByKey.get(key) ?? key
                    return [`${num.toLocaleString('ko-KR')}개`, display] as [string, string]
                  }) as never
                }
              />
              <Legend formatter={(value) => nameByKey.get(String(value)) ?? String(value)} />
              {visibleOptions.map((o) => (
                <Bar key={o.id} dataKey={o.id} stackId="qty" fill={o.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
