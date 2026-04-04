'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Sliders,
  FileText,
  Loader2,
  BarChart3,
  CalendarDays,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { TriggerAnalysisButton } from '@/components/analysis/trigger-analysis-button'
import { AnalysisReportCard } from '@/components/analysis/analysis-report-card'
import { AnalysisRules } from '@/components/analysis/analysis-rules'
import { CampaignSuggestions } from '@/components/analysis/campaign-suggestions'
import { SuggestionList } from '@/components/analysis/suggestion-list'
import { cn } from '@/lib/utils'
import type { AnalysisReport } from '@/types/analysis'

type DatePreset = 7 | 14 | 30

function formatDateISO(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function getPresetRange(days: DatePreset): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from: formatDateISO(from), to: formatDateISO(to) }
}

export default function AnalysisPage() {
  const [reports, setReports] = useState<AnalysisReport[]>([])
  const [loading, setLoading] = useState(true)
  const [activePreset, setActivePreset] = useState<DatePreset>(14)
  const [dateRange, setDateRange] = useState(() => getPresetRange(14))

  const fetchReports = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/analysis/reports')
      if (res.ok) {
        const data = await res.json()
        setReports(Array.isArray(data) ? data : data.reports ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  function handlePresetClick(days: DatePreset) {
    setActivePreset(days)
    setDateRange(getPresetRange(days))
  }

  const latestReport = reports[0] ?? null
  const pastReports = reports.slice(1)

  // Group suggestions by campaign from latest report
  const latestSuggestions = latestReport?.suggestions ?? []
  const latestImprovements = latestReport?.improvementSuggestions ?? []

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">광고 분석</h1>
          <p className="text-sm text-muted-foreground">
            광고 성과를 분석하고 최적화 제안을 확인합니다.
          </p>
        </div>
        <TriggerAnalysisButton
          from={dateRange.from}
          to={dateRange.to}
          onSuccess={fetchReports}
        />
      </div>

      {/* Date Range Presets */}
      <div className="flex items-center gap-3">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <div className="flex items-center gap-2">
          {([7, 14, 30] as DatePreset[]).map((days) => (
            <Button
              key={days}
              variant={activePreset === days ? 'default' : 'outline'}
              size="sm"
              onClick={() => handlePresetClick(days)}
              className="text-xs"
            >
              {days}일
            </Button>
          ))}
        </div>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) => {
              setActivePreset(0 as DatePreset)
              setDateRange((prev) => ({ ...prev, from: e.target.value }))
            }}
            className="rounded-md border bg-background px-2 py-1 text-xs"
          />
          <span>~</span>
          <input
            type="date"
            value={dateRange.to}
            onChange={(e) => {
              setActivePreset(0 as DatePreset)
              setDateRange((prev) => ({ ...prev, to: e.target.value }))
            }}
            className="rounded-md border bg-background px-2 py-1 text-xs"
          />
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty State */}
      {!loading && reports.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <BarChart3 className="mb-4 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">
              아직 분석 리포트가 없습니다
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              위의 &quot;분석 실행&quot; 버튼을 눌러 첫 분석을 시작하세요.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Latest Report — Campaign Suggestions */}
      {!loading && latestReport && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xl font-semibold tracking-tight">
              최신 분석 결과
            </h2>
            <Badge variant="secondary" className="text-[11px]">
              {new Date(latestReport.createdAt).toLocaleDateString('ko-KR')}
            </Badge>
          </div>

          {/* Summary */}
          {latestReport.summary && (
            <Card>
              <CardContent className="py-4">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {latestReport.summary}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Suggestions grouped by campaign */}
          {latestSuggestions.length > 0 && (
            <CampaignSuggestions suggestions={latestSuggestions} />
          )}

          {/* Improvement Suggestions (model-generated rule suggestions) */}
          {latestImprovements.length > 0 && (
            <SuggestionList improvementSuggestions={latestImprovements} />
          )}
        </div>
      )}

      {/* Past Reports History */}
      {!loading && pastReports.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xl font-semibold tracking-tight">
              리포트 히스토리
            </h2>
            <Badge variant="outline" className="text-[11px]">
              {pastReports.length}건
            </Badge>
          </div>
          <div className="space-y-3">
            {pastReports.map((report) => (
              <AnalysisReportCard key={report.id} report={report} />
            ))}
          </div>
        </div>
      )}

      {/* Analysis Rules */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sliders className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold tracking-tight">분석 규칙</h2>
        </div>
        <AnalysisRules />
      </div>
    </div>
  )
}
