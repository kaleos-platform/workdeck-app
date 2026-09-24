'use client'

import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { tierBadgeClass } from './pricing-channel-board-card'

/** 조합 × 채널 1행 (프로모션 적용 후 기준 마진) */
export type OverviewChannelRow = {
  channelId: string
  channelName: string
  /** 현재 설정 판매가. null=권장가 산출 불가 */
  price: number | null
  /** 프로모션 적용가 — 프로모션이 실제로 가격을 낮췄을 때만 */
  promoPrice: number | null
  discount: number | null // 0~1, 판매가 기준
  finalDiscount: number | null // 0~1, 프로모션 적용 후 (적용 시만)
  promotion: string | null
  /** 광고 ROAS % (광고 적용 시만) */
  roasPct: number | null
  margin: number | null // 0~1
  marginAmount: number | null // 원
  tier: 'good' | 'fair' | 'bad' | null
}

export type OverviewVariantRow = {
  variantId: string
  name: string
  cost: number | null
  retail: number | null
  channels: OverviewChannelRow[]
}

function won(n: number | null): string {
  return n == null ? '—' : `₩${Math.round(n).toLocaleString('ko-KR')}`
}
function pct(n: number | null): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`
}

/** 현재 시나리오의 모든 조합을 조합×채널 표로 한눈에 비교. 행 클릭 → 해당 조합 탭으로 이동 */
export function PricingVariantOverviewDialog({
  open,
  onOpenChange,
  rows,
  activeVariantId,
  onSelectVariant,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: OverviewVariantRow[]
  activeVariantId: string
  onSelectVariant: (variantId: string) => void
}) {
  const select = (id: string) => {
    onSelectVariant(id)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>조합 한눈에 보기</DialogTitle>
          <p className="text-xs text-muted-foreground">
            마진은 프로모션 적용 후 기준입니다. 행을 누르면 해당 조합으로 이동합니다.
          </p>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto">
          <Table className="text-xs tabular-nums">
            <TableHeader>
              <TableRow>
                <TableHead>조합</TableHead>
                <TableHead className="text-right">원가</TableHead>
                <TableHead className="text-right">소비자가</TableHead>
                <TableHead>채널</TableHead>
                <TableHead className="text-right">판매가</TableHead>
                <TableHead className="text-right">프로모션 적용가</TableHead>
                <TableHead className="text-right">할인율</TableHead>
                <TableHead>프로모션</TableHead>
                <TableHead className="text-right">광고 ROAS</TableHead>
                <TableHead className="text-right">마진</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((v) => {
                const span = Math.max(1, v.channels.length)
                const active = v.variantId === activeVariantId
                // 조합 셀(rowspan)은 첫 채널 행에만 — 채널 없는 조합도 1행 유지
                const variantCells = (
                  <>
                    <TableCell rowSpan={span} className="align-top font-medium">
                      {v.name}
                      {active && (
                        <Badge variant="secondary" className="ml-1.5 px-1 py-0 text-[10px]">
                          현재
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell rowSpan={span} className="text-right align-top">
                      {won(v.cost)}
                    </TableCell>
                    <TableCell rowSpan={span} className="text-right align-top">
                      {won(v.retail)}
                    </TableCell>
                  </>
                )
                if (v.channels.length === 0) {
                  return (
                    <TableRow
                      key={v.variantId}
                      className="cursor-pointer"
                      onClick={() => select(v.variantId)}
                    >
                      {variantCells}
                      <TableCell colSpan={7} className="text-muted-foreground">
                        {v.cost == null ? '상품 미선택' : '판매채널 없음'}
                      </TableCell>
                    </TableRow>
                  )
                }
                return v.channels.map((c, i) => (
                  <TableRow
                    key={`${v.variantId}-${c.channelId}`}
                    className={cn(
                      'cursor-pointer',
                      i === v.channels.length - 1 ? '' : 'border-b-0'
                    )}
                    onClick={() => select(v.variantId)}
                  >
                    {i === 0 && variantCells}
                    <TableCell>{c.channelName}</TableCell>
                    <TableCell className="text-right">{won(c.price)}</TableCell>
                    <TableCell className="text-right">
                      {c.promoPrice != null ? won(c.promoPrice) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-emerald-700">
                      {c.discount == null
                        ? '—'
                        : c.finalDiscount != null
                          ? `−${pct(c.discount)} → −${pct(c.finalDiscount)}`
                          : `−${pct(c.discount)}`}
                    </TableCell>
                    <TableCell>{c.promotion ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {c.roasPct != null ? `${c.roasPct}%` : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.margin != null && c.tier != null ? (
                        <span className="inline-flex items-center gap-1.5">
                          {won(c.marginAmount)}
                          <Badge
                            variant="outline"
                            className={cn('px-1.5 py-0 text-[11px]', tierBadgeClass(c.tier))}
                          >
                            {(c.margin * 100).toFixed(1)}%
                          </Badge>
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))
              })}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
