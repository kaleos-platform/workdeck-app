'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Panel, fmtQty } from './reorder-ui'

/** 연동 위치 몫의 외부 SKU 별 배분 — 발주 계획 API(dryRun·생성·상세)가 같은 모양으로 준다. */
export type LinkedSkuAllocation = {
  locationId: string
  locationName: string
  snapshotDate: string | null
  skus: Array<{
    code: string
    name: string
    optionName: string | null
    items: { optionId: string; perSet: number }[]
    stock: number
    inbound: number
    sales30d: number
    needSets: number
    allocSets: number
  }>
  loose: Array<{ optionId: string; qty: number }>
}

export function LinkedSkuAllocationPanel({
  allocation,
  optionNameById,
  desc,
  showAfterStock = false,
}: {
  allocation: LinkedSkuAllocation
  optionNameById: Map<string, string>
  desc: string
  /** 재고 열을 「현재 → 입고 후」로 표시 (위저드 검토 단계) */
  showAfterStock?: boolean
}) {
  const [showZero, setShowZero] = useState(false)
  const zeroCount = allocation.skus.filter((k) => k.allocSets <= 0).length
  const visible = showZero ? allocation.skus : allocation.skus.filter((k) => k.allocSets > 0)
  const asOf = allocation.snapshotDate
    ? ` · 쿠팡 재고 ${new Date(allocation.snapshotDate).toLocaleDateString('ko-KR')} 기준`
    : ''
  const optionLabel = (id: string) => optionNameById.get(id) ?? id

  return (
    <Panel
      title={`연동 위치 SKU 배분 — ${allocation.locationName}`}
      desc={desc + asOf}
      padded={false}
      right={
        zeroCount > 0 && (
          <Button type="button" size="sm" variant="outline" onClick={() => setShowZero((v) => !v)}>
            {showZero ? '0세트 접기' : `0세트 ${zeroCount}종 보기`}
          </Button>
        )
      }
    >
      {allocation.skus.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          이 상품을 담은 연동 위치 SKU 매핑이 없습니다. 재고 조정에서 쿠팡 SKU를 매핑하면 SKU별로
          나눠 보여 줍니다.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>쿠팡 SKU</TableHead>
              <TableHead>구성</TableHead>
              <TableHead className="text-right">30일 판매</TableHead>
              <TableHead className="text-right">
                {showAfterStock ? '재고 (현재 → 입고 후)' : '재고'}
              </TableHead>
              <TableHead className="text-right">입고예정</TableHead>
              <TableHead className="text-right">부족</TableHead>
              <TableHead className="text-right">배분</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((k) => (
              <TableRow key={k.code}>
                <TableCell className="max-w-[280px] text-sm">
                  <div className="truncate" title={k.name}>
                    {k.name}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {k.code}
                    {k.optionName ? ` · ${k.optionName}` : ''}
                  </div>
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {k.items.map((it) => `${optionLabel(it.optionId)} ×${it.perSet}`).join(', ')}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {fmtQty(k.sales30d)}
                </TableCell>
                <TableCell className="text-right font-mono whitespace-nowrap tabular-nums">
                  {showAfterStock && k.allocSets > 0 ? (
                    <>
                      <span className="text-muted-foreground">{fmtQty(k.stock)}</span>
                      {' → '}
                      <b>{fmtQty(k.stock + k.allocSets)}</b>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{fmtQty(k.stock)}</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                  {fmtQty(k.inbound)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {fmtQty(k.needSets)}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold whitespace-nowrap tabular-nums">
                  {fmtQty(k.allocSets)}세트
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({fmtQty(k.allocSets * k.items.reduce((a, it) => a + it.perSet, 0))}개)
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {allocation.loose.length > 0 && (
        <p className="border-t px-5 py-3 text-xs text-amber-700">
          SKU로 나누어지지 않아 자체·3PL 위치로 옮긴 수량:{' '}
          {allocation.loose.map((l) => `${optionLabel(l.optionId)} ${fmtQty(l.qty)}개`).join(', ')}{' '}
          — 1장 SKU가 없거나 판매 이력이 없어 연동 위치로 보내지 않습니다.
        </p>
      )}
    </Panel>
  )
}
