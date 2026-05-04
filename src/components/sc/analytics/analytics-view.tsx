'use client'

import { useState, useCallback } from 'react'
import { AnalyticsContentTable } from './analytics-content-table'
import { ContentComparePanel } from './content-compare-panel'
import type { SpaceContentAnalyticsRow } from '@/lib/sc/metrics'
import type { ContentCompareRow } from '@/lib/sc/metrics-types'
import type { ChannelOption } from './analytics-filters'

interface Props {
  contents: SpaceContentAnalyticsRow[]
  channels: ChannelOption[]
}

/**
 * 성과 관리 클라이언트 래퍼.
 * - 체크박스 선택 상태 관리
 * - 비교 데이터 fetch 상태 관리
 * - 비교 패널 표시/숨김 제어
 */
export function AnalyticsView({ contents, channels }: Props) {
  // 선택된 콘텐츠 id 배열 (2~5건 제한)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // 비교 패널 표시 여부
  const [compareOpen, setCompareOpen] = useState(false)
  // 비교 fetch 상태
  const [compareData, setCompareData] = useState<ContentCompareRow[] | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)

  // 체크박스 토글 핸들러 (5건 초과 시 가장 오래된 선택 해제)
  const handleToggle = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        if (prev.includes(id)) return prev
        const next = [...prev, id]
        // 5건 초과 시 첫 번째(가장 오래 선택된) 항목 제거
        return next.length > 5 ? next.slice(1) : next
      } else {
        return prev.filter((x) => x !== id)
      }
    })
  }, [])

  // 선택 초기화
  const handleReset = useCallback(() => {
    setSelectedIds([])
    setCompareOpen(false)
    setCompareData(null)
    setCompareError(null)
  }, [])

  // 비교 보기 — API 호출
  const handleCompare = useCallback(async () => {
    if (selectedIds.length < 2) return
    setCompareLoading(true)
    setCompareError(null)
    setCompareData(null)

    try {
      const res = await fetch(
        `/api/sc/analytics/compare?ids=${encodeURIComponent(selectedIds.join(','))}&days=30`
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(body.message ?? `서버 오류 (${res.status})`)
      }
      const data = (await res.json()) as ContentCompareRow[]
      setCompareData(data)
      setCompareOpen(true)
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : '비교 데이터 조회 실패')
    } finally {
      setCompareLoading(false)
    }
  }, [selectedIds])

  // 비교 패널 닫기
  const handleCloseCompare = useCallback(() => {
    setCompareOpen(false)
  }, [])

  return (
    <div className="space-y-4">
      <AnalyticsContentTable
        contents={contents}
        channels={channels}
        selectedIds={selectedIds}
        onToggle={handleToggle}
        onCompare={handleCompare}
        onResetSelection={handleReset}
        compareLoading={compareLoading}
      />

      {/* 비교 에러 */}
      {compareError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {compareError}
        </div>
      )}

      {/* 비교 패널 */}
      {compareOpen && compareData && (
        <ContentComparePanel data={compareData} onClose={handleCloseCompare} />
      )}
    </div>
  )
}
