'use client'

import { useEffect, useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BalanceTrendCard } from '@/components/finance/balance-trend-card'
import type { BalanceTrendRow } from '@/lib/finance/balance-trend'

type Range = '6' | '12' | 'all'

export function BalanceTrendView() {
  const [range, setRange] = useState<Range>('12')
  // 응답이 어느 range 것인지 함께 둬서 로딩 여부를 파생(effect 내 동기 setState 회피).
  const [result, setResult] = useState<{ range: Range; rows: BalanceTrendRow[] } | null>(null)
  const loading = result?.range !== range

  useEffect(() => {
    let cancelled = false
    fetch(`/api/finance/balance-trend?range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { rows: BalanceTrendRow[] }) => {
        if (!cancelled) setResult({ range, rows: d.rows })
      })
      .catch(() => {
        if (!cancelled) setResult({ range, rows: [] })
      })
    return () => {
      cancelled = true
    }
  }, [range])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
          <TabsList>
            <TabsTrigger value="6">6개월</TabsTrigger>
            <TabsTrigger value="12">12개월</TabsTrigger>
            <TabsTrigger value="all">전체</TabsTrigger>
          </TabsList>
        </Tabs>
        {loading && <span className="text-xs text-muted-foreground">불러오는 중...</span>}
      </div>
      {result &&
        (result.rows.length === 0 ? (
          <div className="rounded-xl border bg-card py-16 text-center text-sm text-muted-foreground shadow-sm">
            잔액 데이터가 없습니다. 은행 거래내역을 업로드하면 월말 잔액이 쌓입니다.
          </div>
        ) : (
          <BalanceTrendCard key={result.range} rows={result.rows} />
        ))}
    </div>
  )
}
