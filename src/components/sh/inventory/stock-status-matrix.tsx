'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { LOCATION_TYPE_LABEL, type StockLocation } from './stock-status.types'
import { StockStatusExportButton } from './stock-status-export'
import { StockGradeMark } from './stock-status-grade'
import { resolveVisibleLocations, type StockStatusRowView } from './stock-status-view-model'

type Props = {
  rows: StockStatusRowView[]
  locations: StockLocation[]
  loading: boolean
  selectedLocationId?: string | null
  /** 관리용 상품명(없으면 공식명) */
  selectedProductName?: string | null
  /** 공식 상품명 — 관리명과 다를 때만 병기 */
  selectedProductOfficialName?: string | null
  /** 사용자가 화면에서 숨긴 위치 — 합계·등급·엑셀에는 영향 없음 */
  hiddenLocationIds?: string[]
  toolbar?: ReactNode
  /** 위치 컬럼 선택 UI — 위치 탭 선택 중에는 board 가 넘기지 않는다 */
  locationPicker?: ReactNode
  /** 등급 기준 안내·편집 팝오버 */
  gradeInfo?: ReactNode
  /** 옵션 상태 일괄 변경 — 넘기면 행 선택 체크박스가 생긴다 */
  onSetOptionStatus?: (optionIds: string[], status: 'ACTIVE' | 'DISCONTINUED') => Promise<void>
}

const KRW = new Intl.NumberFormat('ko-KR')
const ROW_CAP = 500

export function StockStatusMatrix({
  rows,
  locations,
  loading,
  selectedLocationId,
  selectedProductName,
  selectedProductOfficialName,
  hiddenLocationIds,
  toolbar,
  locationPicker,
  gradeInfo,
  onSetOptionStatus,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [savingStatus, setSavingStatus] = useState(false)
  // 상품·필터·검색이 바뀌면 선택을 비운다 — 화면 밖 선택이 되살아나 일괄 변경되지 않게
  useEffect(() => {
    setSelectedIds(new Set())
  }, [rows])
  // 상품을 바꾸면 행이 바뀐다 — 화면에 없는 옵션이 선택에 남지 않게 교집합만 쓴다.
  const pickedIds = rows.filter((r) => selectedIds.has(r.optionId)).map((r) => r.optionId)

  async function applyStatus(status: 'ACTIVE' | 'DISCONTINUED') {
    if (!onSetOptionStatus || pickedIds.length === 0) return
    setSavingStatus(true)
    try {
      await onSetOptionStatus(pickedIds, status)
      setSelectedIds(new Set())
    } finally {
      setSavingStatus(false)
    }
  }

  const capped = rows.length > ROW_CAP
  const displayRows = capped ? rows.slice(0, ROW_CAP) : rows
  const visibleLocations = resolveVisibleLocations(
    locations,
    hiddenLocationIds ?? [],
    selectedLocationId ?? null
  )
  const hiddenCount = locations.length - visibleLocations.length

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="gap-3">
        <CardTitle className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
          <span>{selectedProductName ?? '상품 없음'}</span>
          {selectedProductName &&
            selectedProductOfficialName &&
            selectedProductOfficialName !== selectedProductName && (
              <span className="text-xs font-normal text-muted-foreground">
                {selectedProductOfficialName}
              </span>
            )}
        </CardTitle>
        {onSetOptionStatus && pickedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs">
            <span className="font-medium">{pickedIds.length}개 옵션 선택</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={savingStatus}
              onClick={() => applyStatus('DISCONTINUED')}
              title="생산·발주 대상에서 제외합니다. 남은 재고는 계속 판매·출고되고, 재고가 0이 되면 이 화면에서 숨겨집니다"
            >
              단종 처리
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={savingStatus}
              onClick={() => applyStatus('ACTIVE')}
            >
              판매중으로
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => setSelectedIds(new Set())}
            >
              선택 해제
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {toolbar}
            {locationPicker}
            {gradeInfo}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-muted-foreground">
              {KRW.format(rows.length)}건{capped && ` · 상위 ${ROW_CAP}건만 표시`}
              {hiddenCount > 0 && ` · 위치 ${hiddenCount}곳 숨김(합계는 전체 기준)`}
            </div>
            <StockStatusExportButton
              rows={rows}
              locations={locations}
              selectedLocationId={selectedLocationId ?? null}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">표시할 SKU가 없습니다</p>
        ) : (
          <div className="h-full min-h-0 overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-20 bg-muted">
                <tr className="border-b">
                  <th className="sticky left-0 z-30 min-w-[170px] border-r bg-muted px-3 py-2 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    옵션
                  </th>
                  <th className="min-w-[100px] border-l bg-muted px-2 py-2 text-center text-[11px] font-medium text-muted-foreground">
                    <div className="font-semibold text-foreground">출고 30/90일</div>
                    <div className="text-[10px] font-normal text-muted-foreground">판매채널</div>
                  </th>
                  {visibleLocations.map((l) => (
                    <th
                      key={l.id}
                      className="w-[84px] max-w-[84px] min-w-[84px] border-l bg-muted px-2 py-2 text-center text-[11px] font-medium text-muted-foreground"
                    >
                      <div className="truncate font-semibold text-foreground" title={l.name}>
                        {l.name}
                      </div>
                      <div className="text-[10px] font-normal text-muted-foreground">
                        {LOCATION_TYPE_LABEL[l.type]}
                      </div>
                    </th>
                  ))}
                  <th className="min-w-[76px] border-l bg-muted px-2 py-2 text-center text-[11px] font-medium text-muted-foreground">
                    <div className="flex items-center justify-center gap-1 font-semibold text-foreground">
                      <span>입고예정</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 cursor-help text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[260px] text-xs">
                          생산 관리에서 진행중 상태인 생산차수의 미입고 수량입니다. 계획중/완료는
                          제외됩니다.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="text-[10px] font-normal text-muted-foreground">생산 관리</div>
                  </th>
                  <th className="sticky right-0 z-30 min-w-[120px] border-l bg-muted px-3 py-2 text-right text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    합계
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => {
                  return (
                    <tr key={row.optionId} className="border-b hover:bg-muted/30">
                      <td className="sticky left-0 z-10 border-r bg-card px-3 py-2">
                        {/* 매트릭스는 항상 한 상품만 보여주고 상품명은 카드 제목에 있다 —
                            행마다 상품명을 반복하면 옵션 컬럼만 넓어지고 정보는 늘지 않는다. */}
                        <div className="flex min-w-0 items-start gap-2">
                          {onSetOptionStatus && (
                            <Checkbox
                              className="mt-0.5"
                              checked={selectedIds.has(row.optionId)}
                              onCheckedChange={(v) =>
                                setSelectedIds((prev) => {
                                  const next = new Set(prev)
                                  if (v) next.add(row.optionId)
                                  else next.delete(row.optionId)
                                  return next
                                })
                              }
                              aria-label={`${row.optionName} 선택`}
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{row.optionName}</span>
                              {row.optionStatus === 'DISCONTINUED' && (
                                <Badge
                                  variant="outline"
                                  className="shrink-0 border-zinc-300 px-1 py-0 text-[10px] font-normal text-zinc-500"
                                  title="단종 — 생산·발주에서 제외. 재고가 0이 되면 숨겨집니다"
                                >
                                  단종
                                </Badge>
                              )}
                            </div>
                            {row.sku && (
                              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                {row.sku}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="border-l px-2 py-2 text-center font-mono text-sm tabular-nums">
                        {row.out30d > 0 || row.out90d > 0 ? (
                          <>
                            {KRW.format(row.out30d)}
                            <span className="text-muted-foreground/60"> / </span>
                            {KRW.format(row.out90d)}
                          </>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      {visibleLocations.map((l) => {
                        const qty = row.byLocation[l.id]
                        const returnQty = row.returnQtyByLocation?.[l.id] ?? 0
                        // 셀 단위 출고량 데이터가 없어 위치별 부족 판정 불가.
                        // 상태(부족/과잉)는 합계 컬럼의 배지로만 표시하고, 셀은 결품(0)만 강조.
                        return (
                          <td
                            key={l.id}
                            className={cn(
                              'border-l px-2 py-2 text-center font-mono text-sm tabular-nums',
                              qty === undefined
                                ? 'text-muted-foreground/50'
                                : qty === 0
                                  ? 'bg-red-50 text-red-700'
                                  : ''
                            )}
                          >
                            {qty === undefined ? '—' : KRW.format(qty)}
                            {returnQty > 0 && (
                              <div
                                className="text-[10px] font-normal text-muted-foreground/70"
                                title="쿠팡 반품 등급 재고 — 위 수량에 포함돼 있습니다. 발주 계획에서는 제외됩니다."
                              >
                                반품 {KRW.format(returnQty)}
                              </div>
                            )}
                          </td>
                        )
                      })}
                      {/* 입고예정 컬럼 */}
                      <td className="border-l px-2 py-2 text-center font-mono text-sm tabular-nums">
                        {row.incomingQty > 0 ? (
                          <span className="text-blue-600">{KRW.format(row.incomingQty)}</span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      {/* 합계 + 상태 */}
                      <td className="sticky right-0 z-10 border-l bg-card px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <StockGradeMark
                            grade={row.grade}
                            daysOfCover={row.daysOfCover}
                            hideLabel
                          />
                          <span
                            className={cn(
                              'font-mono text-sm font-semibold tabular-nums',
                              row.negative && 'text-red-700'
                            )}
                          >
                            {KRW.format(row.displayQty)}
                          </span>
                        </div>
                        {row.negative ? (
                          <div className="text-[11px] text-red-700">장부 이상(음수)</div>
                        ) : (
                          !selectedLocationId &&
                          row.incomingQty > 0 && (
                            <div className="text-[11px] text-muted-foreground tabular-nums">
                              현재 {KRW.format(row.currentQty)}
                            </div>
                          )
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {capped && (
          <div className="border-t bg-muted/20 px-4 py-2 text-center text-xs text-muted-foreground">
            결과가 많습니다. 검색이나 필터로 좁혀주세요.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
