'use client'

/** 현금흐름 상세 — 선택 기간 버킷별 수입·지출 막대(요약 대시보드에서 이관). */
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
import { formatWon, formatWonShort } from '@/components/finance/format'
import { bucketLabel, type Grain } from '@/lib/finance/periods'

export function CashflowTrendChart({
  buckets,
  grain,
  income,
  expense,
}: {
  buckets: string[]
  grain: Grain
  income: Record<string, number>
  expense: Record<string, number>
}) {
  const data = buckets.map((b) => ({
    label: bucketLabel(b, grain),
    income: income[b] ?? 0,
    expense: expense[b] ?? 0,
  }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>현금흐름 추이</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatWonShort(v).replace('₩', '')}
              width={56}
            />
            <Tooltip
              formatter={((value: number, name: string) => [formatWon(value), name]) as never}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="income" name="수입" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="expense" name="지출" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
