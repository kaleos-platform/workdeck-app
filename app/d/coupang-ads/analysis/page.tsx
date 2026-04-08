'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  FileText,
  Loader2,
  Settings2,
  Sliders,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { TriggerAnalysisButton } from '@/components/analysis/trigger-analysis-button'
import { AnalysisRules } from '@/components/analysis/analysis-rules'
import { CampaignSuggestions } from '@/components/analysis/campaign-suggestions'
import { SuggestionList } from '@/components/analysis/suggestion-list'
import { AnalysisSchedule } from '@/components/analysis/analysis-schedule'
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

type ScheduleSummary = {
  enabled: boolean
  intervalDays: number
  lastAnalyzedAt: string | null
}

export default function AnalysisPage() {
  const [reports, setReports] = useState<AnalysisReport[]>([])
  const [loading, setLoading] = useState(true)
  const [activePreset, setActivePreset] = useState<DatePreset>(14)
  const [dateRange, setDateRange] = useState(() => getPresetRange(14))
  const [campaignNames, setCampaignNames] = useState<Record<string, string>>({})
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)

  // 상단 배너 상태
  const [schedule, setSchedule] = useState<ScheduleSummary | null>(null)
  const [rulesCount, setRulesCount] = useState(0)

  const fetchReports = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/analysis/reports')
      if (res.ok) {
        const data = await res.json()
        const list: AnalysisReport[] = Array.isArray(data) ? data : data.reports ?? []
        setReports(list)
        if (list.length > 0 && !selectedReportId) {
          setSelectedReportId(list[0].id)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [selectedReportId])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  // 캠페인명 로드
  useEffect(() => {
    fetch('/api/campaigns')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: { id: string; name: string; displayName?: string }[]) => {
        const map: Record<string, string> = {}
        for (const c of data) map[c.id] = c.displayName || c.name
        setCampaignNames(map)
      })
      .catch(() => {})
  }, [])

  // 스케줄 요약 로드
  useEffect(() => {
    fetch('/api/analysis/schedule')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const s = data?.schedule ?? data
        if (s) setSchedule(s)
      })
      .catch(() => {})
  }, [])

  // 규칙 개수 로드 (Dialog 열기 전에도 표시)
  useEffect(() => {
    fetch('/api/analysis/rules')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.rules ?? []
        setRulesCount(list.length)
      })
      .catch(() => {})
  }, [])

  function handlePresetClick(days: DatePreset) {
    setActivePreset(days)
    setDateRange(getPresetRange(days))
  }

  async function handleDeleteReport(reportId: string) {
    if (!confirm('이 분석 리포트를 삭제하시겠습니까?')) return
    try {
      const res = await fetch(`/api/analysis/reports/${reportId}`, { method: 'DELETE' })
      if (res.ok) {
        setReports((prev) => prev.filter((r) => r.id !== reportId))
        if (selectedReportId === reportId) {
          setSelectedReportId(reports.find((r) => r.id !== reportId)?.id ?? null)
        }
        toast.success('리포트가 삭제되었습니다')
      } else {
        toast.error('삭제에 실패했습니다')
      }
    } catch {
      toast.error('삭제 중 오류가 발생했습니다')
    }
  }

  const selectedReport = reports.find((r) => r.id === selectedReportId) ?? null

  // 진행 중인 분석 감지
  const activeReport = reports.find((r) => r.status === 'PENDING' || r.status === 'PROCESSING')

  // 진행 중이면 5초마다 자동 새로고침 (silent — 깜빡임 방지)
  useEffect(() => {
    if (!activeReport) return
    const interval = setInterval(() => fetchReports(true), 5000)
    return () => clearInterval(interval)
  }, [activeReport?.id, fetchReports])

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">광고 분석</h1>
        <p className="text-sm text-muted-foreground">
          광고 성과를 분석하고 최적화 제안을 확인합니다.
        </p>
      </div>

      {/* ─── 상단 배너: 스케줄 요약 + 규칙 개수 ─── */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-6">
          {/* 자동 분석 스케줄 */}
          <div className="flex items-center gap-2 text-sm">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            {schedule?.enabled ? (
              <span>
                <span className="font-medium">{schedule.intervalDays}일</span>마다 자동 분석
                {schedule.lastAnalyzedAt && (
                  <span className="text-muted-foreground">
                    {' '}| 다음:{' '}
                    {(() => {
                      const next = new Date(schedule.lastAnalyzedAt)
                      next.setDate(next.getDate() + schedule.intervalDays)
                      return next.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
                    })()}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">자동 분석 미설정</span>
            )}
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                  <Settings2 className="h-3 w-3" />
                  설정
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>자동 분석 설정</DialogTitle>
                </DialogHeader>
                <AnalysisSchedule embedded />
              </DialogContent>
            </Dialog>
          </div>

          <Separator orientation="vertical" className="h-5" />

          {/* 분석 규칙 */}
          <div className="flex items-center gap-2 text-sm">
            <Sliders className="h-4 w-4 text-muted-foreground" />
            <span>
              규칙 <Badge variant="secondary" className="ml-1 text-[10px]">{rulesCount}개</Badge>
            </span>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                  <Settings2 className="h-3 w-3" />
                  관리
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>분석 규칙 관리</DialogTitle>
                </DialogHeader>
                <AnalysisRules onRulesCountChange={setRulesCount} embedded />
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* ─── Date Range Presets + 분석 실행/종료 ─── */}
      <div className="flex items-center justify-between">
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
        <TriggerAnalysisButton
          from={dateRange.from}
          to={dateRange.to}
          onSuccess={fetchReports}
          activeReportId={activeReport?.id ?? null}
        />
      </div>

      {/* ─── Loading ─── */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* ─── Empty State ─── */}
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

      {/* ─── 2열 레이아웃: 리포트 리스트 + 상세 ─── */}
      {!loading && reports.length > 0 && (
        <div className="grid grid-cols-[280px_1fr] gap-6">
          {/* 좌측: 리포트 리스트 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 pb-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">분석 이력</h3>
              <Badge variant="outline" className="text-[10px]">
                {reports.length}건
              </Badge>
            </div>
            <div className="space-y-1.5 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
              {reports.map((report) => {
                const isSelected = report.id === selectedReportId
                const date = new Date(report.createdAt)
                const suggestionCount = report.suggestions?.length ?? 0
                const metadata = report.metadata as { campaignCount?: number } | null

                return (
                  <div key={report.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => setSelectedReportId(report.id)}
                      className={cn(
                        'w-full rounded-lg border p-3 text-left transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/50',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium">
                            {date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                            {' '}
                            {date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <TriggerBadge triggeredBy={report.triggeredBy} />
                        </div>
                        <StatusDot status={report.status} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground truncate">
                        {report.status === 'COMPLETED'
                          ? `${metadata?.campaignCount ?? '-'}개 캠페인, ${suggestionCount}개 제안`
                          : report.status === 'FAILED'
                            ? '분석 실패'
                            : report.status === 'PROCESSING'
                              ? '분석 중...'
                              : '대기 중'}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleDeleteReport(report.id) }}
                      className="absolute bottom-2 right-2 hidden rounded p-1 text-muted-foreground hover:text-destructive group-hover:block"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 우측: 선택된 리포트 상세 */}
          <div className="space-y-4 min-h-[300px]">
            {selectedReport ? (
              <>
                {/* 요약 */}
                {selectedReport.summary && (
                  <Card>
                    <CardContent className="py-4">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {selectedReport.summary}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {new Date(selectedReport.periodStart).toLocaleDateString('ko-KR')} ~{' '}
                        {new Date(selectedReport.periodEnd).toLocaleDateString('ko-KR')}
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* 캠페인별 제안 */}
                {(selectedReport.suggestions?.length ?? 0) > 0 && (
                  <CampaignSuggestions
                    suggestions={selectedReport.suggestions}
                    campaignNames={campaignNames}
                  />
                )}

                {/* 개선 규칙 제안 */}
                {(selectedReport.improvementSuggestions?.length ?? 0) > 0 && (
                  <SuggestionList
                    improvementSuggestions={selectedReport.improvementSuggestions!}
                  />
                )}

                {/* 실패 상태 */}
                {selectedReport.status === 'FAILED' && (
                  <Card>
                    <CardContent className="py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        {selectedReport.summary || '분석 실행에 실패했습니다.'}
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* 처리 중 */}
                {(selectedReport.status === 'PROCESSING' || selectedReport.status === 'PENDING') && (
                  <Card>
                    <CardContent className="flex items-center justify-center gap-2 py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">분석 진행 중...</p>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card>
                <CardContent className="flex items-center justify-center py-16">
                  <p className="text-sm text-muted-foreground">
                    왼쪽에서 리포트를 선택하세요.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const TRIGGER_CONFIG: Record<string, { label: string; className: string }> = {
  manual: { label: '수동', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  scheduled: { label: '자동', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
  collection: { label: '수집 후', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
}

function TriggerBadge({ triggeredBy }: { triggeredBy?: string }) {
  const config = TRIGGER_CONFIG[triggeredBy ?? 'manual']
  if (!config) return null
  return (
    <Badge className={cn('text-[9px] px-1 py-0 leading-tight', config.className)}>
      {config.label}
    </Badge>
  )
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: 'bg-green-500',
    PROCESSING: 'bg-blue-500 animate-pulse',
    PENDING: 'bg-yellow-500',
    FAILED: 'bg-red-500',
  }

  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full', colors[status] ?? 'bg-gray-400')}
    />
  )
}
