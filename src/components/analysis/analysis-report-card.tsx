'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { cn } from '@/lib/utils'
import { SuggestionList } from '@/components/analysis/suggestion-list'
import type { AnalysisReport, AnalysisStatus, AnalysisType } from '@/types/analysis'

const STATUS_CONFIG: Record<
  AnalysisStatus,
  { label: string; className: string }
> = {
  COMPLETED: {
    label: '완료',
    className:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  },
  PROCESSING: {
    label: '분석 중',
    className:
      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  },
  PENDING: {
    label: '대기',
    className:
      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  },
  FAILED: {
    label: '실패',
    className:
      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
}

const REPORT_TYPE_LABEL: Record<AnalysisType, string> = {
  DAILY_REVIEW: '일간 리뷰',
  KEYWORD_AUDIT: '키워드 감사',
  BUDGET_OPTIMIZATION: '예산 최적화',
  CAMPAIGN_SCORING: '캠페인 스코어링',
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

type AnalysisReportCardProps = {
  report: AnalysisReport
}

export function AnalysisReportCard({ report }: AnalysisReportCardProps) {
  const statusConfig = STATUS_CONFIG[report.status]

  return (
    <Card>
      <Accordion type="single" collapsible>
        <AccordionItem value={report.id} className="border-b-0">
          <CardHeader className="pb-0">
            <AccordionTrigger className="py-0 hover:no-underline">
              <div className="flex flex-1 flex-col items-start gap-2 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[11px]">
                    {REPORT_TYPE_LABEL[report.reportType]}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      'border-transparent text-[11px]',
                      statusConfig.className
                    )}
                  >
                    {statusConfig.label}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {formatDate(report.periodStart)} ~{' '}
                    {formatDate(report.periodEnd)}
                  </span>
                  <span>&middot;</span>
                  <span>{formatDate(report.createdAt)} 생성</span>
                  {report.suggestions.length > 0 && (
                    <>
                      <span>&middot;</span>
                      <span>제안 {report.suggestions.length}건</span>
                    </>
                  )}
                </div>
              </div>
            </AccordionTrigger>
          </CardHeader>

          <AccordionContent>
            <CardContent className="pt-4">
              <div className="space-y-4">
                {report.summary && (
                  <div className="rounded-md bg-muted/50 p-3">
                    <p className="text-sm whitespace-pre-wrap">
                      {report.summary}
                    </p>
                  </div>
                )}

                {report.suggestions.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-sm font-medium">개선 제안</h4>
                    <SuggestionList suggestions={report.suggestions} />
                  </div>
                )}
              </div>
            </CardContent>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  )
}
