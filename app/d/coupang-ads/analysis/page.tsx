'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { getDaysAgoStrKst, getTodayStrKst } from '@/lib/date-range'
import { TriggerAnalysisButton } from '@/components/analysis/trigger-analysis-button'
import { AnalysisReportCard } from '@/components/analysis/analysis-report-card'
import type { AnalysisReport } from '@/types/analysis'

const QUICK_PERIODS = [
  { label: '7일', days: 7 },
  { label: '14일', days: 14 },
  { label: '30일', days: 30 },
]

export default function AnalysisPage() {
  const today = getTodayStrKst()
  const [from, setFrom] = useState(getDaysAgoStrKst(7))
  const [to, setTo] = useState(getDaysAgoStrKst(1))
  const [activePreset, setActivePreset] = useState<number | null>(7)

  const [reports, setReports] = useState<AnalysisReport[]>([])
  const [loading, setLoading] = useState(true)

  const fetchReports = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/analysis/reports')
      if (res.ok) {
        const data = (await res.json()) as AnalysisReport[]
        setReports(data)
      }
    } catch {
      // 조용히 실패
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  function handlePreset(days: number) {
    setFrom(getDaysAgoStrKst(days))
    setTo(getDaysAgoStrKst(1))
    setActivePreset(days)
  }

  function handleFromChange(value: string) {
    const clamped = value > today ? today : value
    setFrom(clamped)
    setActivePreset(null)
  }

  function handleToChange(value: string) {
    const clamped = value > today ? today : value
    setTo(clamped)
    setActivePreset(null)
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">광고 분석</h1>
          <p className="text-sm text-muted-foreground">
            광고 데이터를 분석하고 개선 제안을 확인하세요
          </p>
        </div>
        <TriggerAnalysisButton
          startDate={from}
          endDate={to}
          onSuccess={fetchReports}
        />
      </div>

      {/* 날짜 선택 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          {QUICK_PERIODS.map((p) => (
            <Button
              key={p.days}
              variant={activePreset === p.days ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => handlePreset(p.days)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={from}
            max={today}
            onChange={(e) => handleFromChange(e.target.value)}
            className="h-7 w-32 text-xs"
          />
          <span className="text-xs text-muted-foreground">~</span>
          <Input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => handleToChange(e.target.value)}
            className="h-7 w-32 text-xs"
          />
        </div>
      </div>

      {/* 리포트 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            리포트 불러오는 중...
          </span>
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">
            아직 분석 리포트가 없습니다
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            위의 &quot;분석 실행&quot; 버튼을 눌러 첫 분석을 시작하세요
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <AnalysisReportCard key={report.id} report={report} />
          ))}
        </div>
      )}
    </div>
  )
}
