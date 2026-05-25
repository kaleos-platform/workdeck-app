'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertTriangle,
  ChevronDown,
  RotateCcw,
  Warehouse,
  Trophy,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  InventoryAnalysisResults,
  StockShortageItem,
  ReturnRateItem,
  StorageFeeItem,
  WinnerStatusItem,
} from '@/lib/inventory-analyzer'

type AnalysisData = {
  id: string
  analysedAt: string
  snapshotDate: string
  results: InventoryAnalysisResults
  shortageCount: number
  returnRateCount: number
  storageFeeCount: number
  winnerIssueCount: number
}

export function InventoryAnalysisPanel() {
  const [data, setData] = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [staleConfirmOpen, setStaleConfirmOpen] = useState(false)

  const fetchAnalysis = useCallback(() => {
    fetch('/api/inventory/analysis')
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchAnalysis()
  }, [fetchAnalysis])

  const runReanalyze = async () => {
    setReanalyzing(true)
    try {
      const res = await fetch('/api/inventory/analysis', { method: 'POST' })
      if (res.ok) {
        fetchAnalysis()
      }
    } catch {
      // ignore
    } finally {
      setReanalyzing(false)
    }
  }

  const confirmStaleReanalyze = () => {
    setStaleConfirmOpen(false)
    void runReanalyze()
  }

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (loading) return null
  if (!data) return null

  const totalIssues =
    data.shortageCount + data.returnRateCount + data.storageFeeCount + data.winnerIssueCount

  const analysedDate = new Date(data.analysedAt).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  // Stale 감지 — snapshotDate가 KST 자정 기준 2일 이상 오래되면 경고 배너 표시
  const snapshotKstMidnight = new Date(
    new Date(data.snapshotDate).toLocaleString('en-US', { timeZone: 'Asia/Seoul' })
  )
  snapshotKstMidnight.setHours(0, 0, 0, 0)
  const todayKstMidnight = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  todayKstMidnight.setHours(0, 0, 0, 0)
  const staleAgeDays = Math.floor(
    (todayKstMidnight.getTime() - snapshotKstMidnight.getTime()) / 86_400_000
  )
  const isStale = staleAgeDays >= 2
  const snapshotLabel = new Date(data.snapshotDate).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">재고 분석</CardTitle>
            {totalIssues > 0 ? (
              <Badge variant="destructive" className="text-xs">
                {totalIssues}건 이슈
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">
                이슈 없음
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{analysedDate}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => (isStale ? setStaleConfirmOpen(true) : void runReanalyze())}
              disabled={reanalyzing}
              className="h-7 text-xs"
            >
              {reanalyzing ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3 w-3" />
              )}
              재분석
            </Button>
          </div>
        </div>
      </CardHeader>

      {isStale && (
        <CardContent className="pt-0 pb-3">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            ⚠️ 기준 데이터가 {staleAgeDays}일 전({snapshotLabel})입니다. 워커의 재고 수집 상태를
            확인하세요.
          </div>
        </CardContent>
      )}

      {totalIssues > 0 && (
        <CardContent className="space-y-2 pt-0">
          {data.shortageCount > 0 && (
            <AnalysisSection
              title="재고 부족"
              count={data.shortageCount}
              icon={<AlertTriangle className="h-4 w-4" />}
              color="text-red-600"
              bgColor="bg-red-50"
              expanded={expandedSections.has('shortage')}
              onToggle={() => toggleSection('shortage')}
            >
              <ShortageTable items={data.results.stockShortage} />
            </AnalysisSection>
          )}

          {data.returnRateCount > 0 && (
            <AnalysisSection
              title="높은 반품율"
              count={data.returnRateCount}
              icon={<RotateCcw className="h-4 w-4" />}
              color="text-yellow-600"
              bgColor="bg-yellow-50"
              expanded={expandedSections.has('returnRate')}
              onToggle={() => toggleSection('returnRate')}
            >
              <ReturnRateTable items={data.results.returnRate} />
            </AnalysisSection>
          )}

          {data.storageFeeCount > 0 && (
            <AnalysisSection
              title="보관료 주의"
              count={data.storageFeeCount}
              icon={<Warehouse className="h-4 w-4" />}
              color="text-orange-600"
              bgColor="bg-orange-50"
              expanded={expandedSections.has('storageFee')}
              onToggle={() => toggleSection('storageFee')}
            >
              <StorageFeeTable items={data.results.storageFee} />
            </AnalysisSection>
          )}

          {data.winnerIssueCount > 0 && (
            <AnalysisSection
              title="위너 미달성"
              count={data.winnerIssueCount}
              icon={<Trophy className="h-4 w-4" />}
              color="text-blue-600"
              bgColor="bg-blue-50"
              expanded={expandedSections.has('winner')}
              onToggle={() => toggleSection('winner')}
            >
              <WinnerStatusTable items={data.results.winnerStatus} />
            </AnalysisSection>
          )}
        </CardContent>
      )}

      <Dialog open={staleConfirmOpen} onOpenChange={setStaleConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>오래된 기준 데이터로 재분석</DialogTitle>
            <DialogDescription>
              기준 데이터가 {staleAgeDays}일 전({snapshotLabel})입니다. 이대로 재분석하면 Slack에도
              오래된 기준일로 발송됩니다. 진행할까요?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStaleConfirmOpen(false)}>
              취소
            </Button>
            <Button variant="destructive" onClick={confirmStaleReanalyze}>
              오래된 데이터로 진행
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ─── 섹션 컴포넌트 ──────────────────────────────────────────────────────────────

function AnalysisSection({
  title,
  count,
  icon,
  color,
  bgColor,
  expanded,
  onToggle,
  children,
}: {
  title: string
  count: number
  icon: React.ReactNode
  color: string
  bgColor: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className={cn('rounded-lg border', bgColor)}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className={color}>{icon}</span>
          <span className={cn('text-sm font-medium', color)}>{title}</span>
          <Badge variant="outline" className={cn('text-xs', color)}>
            {count}건
          </Badge>
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform',
            expanded && 'rotate-180'
          )}
        />
      </button>
      {expanded && <div className="border-t px-4 py-3">{children}</div>}
    </div>
  )
}

// ─── 테이블 컴포넌트 ────────────────────────────────────────────────────────────

function ShortageTable({ items }: { items: StockShortageItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pr-4 pb-2">상품명</th>
            <th className="pr-4 pb-2">옵션명</th>
            <th className="pr-4 pb-2 text-right">재고</th>
            <th className="pr-4 pb-2 text-right">판매(30일)</th>
            <th className="pr-4 pb-2 text-right">입고예정</th>
            <th className="pb-2 text-right font-semibold text-red-600">필요입고</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.optionId} className="border-t border-red-100">
              <td className="truncate py-2 pr-4" style={{ maxWidth: 200 }}>
                {item.productName}
              </td>
              <td className="truncate py-2 pr-4 text-muted-foreground" style={{ maxWidth: 150 }}>
                {item.optionName ?? '-'}
              </td>
              <td className="py-2 pr-4 text-right">{item.availableStock.toLocaleString()}</td>
              <td className="py-2 pr-4 text-right">{item.salesQty30d.toLocaleString()}</td>
              <td className="py-2 pr-4 text-right">{item.inboundStock.toLocaleString()}</td>
              <td className="py-2 text-right font-semibold text-red-600">
                {item.requiredRestockQty.toLocaleString()}개
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReturnRateTable({ items }: { items: ReturnRateItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pr-4 pb-2">상품명</th>
            <th className="pr-4 pb-2">옵션명</th>
            <th className="pr-4 pb-2 text-right">반품수</th>
            <th className="pr-4 pb-2 text-right">판매수</th>
            <th className="pb-2 text-right font-semibold text-yellow-600">반품율</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.optionId} className="border-t border-yellow-100">
              <td className="truncate py-2 pr-4" style={{ maxWidth: 200 }}>
                {item.productName}
              </td>
              <td className="truncate py-2 pr-4 text-muted-foreground" style={{ maxWidth: 150 }}>
                {item.optionName ?? '-'}
              </td>
              <td className="py-2 pr-4 text-right">{item.returns30d.toLocaleString()}</td>
              <td className="py-2 pr-4 text-right">{item.salesQty30d.toLocaleString()}</td>
              <td className="py-2 text-right font-semibold text-yellow-600">
                {item.returnRatePct}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StorageFeeTable({ items }: { items: StorageFeeItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pr-4 pb-2">상품명</th>
            <th className="pr-4 pb-2">옵션명</th>
            <th className="pr-4 pb-2 text-right">보관료</th>
            <th className="pr-4 pb-2 text-right">매출(30일)</th>
            <th className="pb-2 text-right font-semibold text-orange-600">보관료율</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.optionId} className="border-t border-orange-100">
              <td className="truncate py-2 pr-4" style={{ maxWidth: 200 }}>
                {item.productName}
              </td>
              <td className="truncate py-2 pr-4 text-muted-foreground" style={{ maxWidth: 150 }}>
                {item.optionName ?? '-'}
              </td>
              <td className="py-2 pr-4 text-right">{item.storageFee.toLocaleString()}원</td>
              <td className="py-2 pr-4 text-right">
                {item.revenue30d > 0 ? `${item.revenue30d.toLocaleString()}원` : '-'}
              </td>
              <td className="py-2 text-right font-semibold text-orange-600">
                {item.storageFeeRatioPct != null ? `${item.storageFeeRatioPct}%` : '매출 없음'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WinnerStatusTable({ items }: { items: WinnerStatusItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pr-4 pb-2">상품명</th>
            <th className="pr-4 pb-2">옵션명</th>
            <th className="pb-2 text-right font-semibold text-blue-600">재고</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.optionId} className="border-t border-blue-100">
              <td className="truncate py-2 pr-4" style={{ maxWidth: 200 }}>
                {item.productName}
              </td>
              <td className="truncate py-2 pr-4 text-muted-foreground" style={{ maxWidth: 150 }}>
                {item.optionName ?? '-'}
              </td>
              <td className="py-2 text-right font-semibold text-blue-600">
                {item.availableStock.toLocaleString()}개
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
