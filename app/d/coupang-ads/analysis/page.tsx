'use client'

import { useState, useEffect } from 'react'
import { Sliders, FileText, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SuggestionList } from '@/components/analysis/suggestion-list'
import { AnalysisRules } from '@/components/analysis/analysis-rules'
import type { AnalysisReport } from '@/types/analysis'

export default function AnalysisPage() {
  const [reports, setReports] = useState<AnalysisReport[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchReports() {
      try {
        const res = await fetch('/api/analysis/reports')
        if (res.ok) {
          const data = await res.json()
          setReports(Array.isArray(data) ? data : data.reports ?? [])
        }
      } finally {
        setLoading(false)
      }
    }
    fetchReports()
  }, [])

  const latestReport = reports[0] ?? null

  return (
    <div className="space-y-8">
      {/* 페이지 헤더 */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">분석</h1>
        <p className="text-sm text-muted-foreground">
          광고 성과 분석 리포트와 규칙을 관리합니다.
        </p>
      </div>

      {/* 분석 리포트 목록 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-5 w-5 text-muted-foreground" />
            분석 리포트
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : reports.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              아직 분석 리포트가 없습니다.
            </p>
          ) : (
            <div className="space-y-3">
              {reports.map((report) => (
                <div key={report.id} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">{report.reportType}</h3>
                    <span className="text-xs text-muted-foreground">
                      {new Date(report.createdAt).toLocaleDateString('ko-KR')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{report.summary}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 분석 개선 제안 */}
      {latestReport?.improvementSuggestions && latestReport.improvementSuggestions.length > 0 && (
        <SuggestionList improvementSuggestions={latestReport.improvementSuggestions} />
      )}

      {/* 분석 규칙 */}
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
