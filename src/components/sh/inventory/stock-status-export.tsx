'use client'

import * as XLSX from 'xlsx'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { StockLocation, StockMatrixRow } from './stock-status.types'

type Props = {
  rows: StockMatrixRow[]
  locations: StockLocation[]
  selectedLocationId: string | null
}

const HEADERS = [
  '브랜드',
  '카테고리',
  '상품명',
  '옵션명',
  'SKU',
  '제품코드',
  'externalCode',
  '위치명',
  '위치ID',
  '현재재고',
  '실재고',
]

function todayYMD() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

export function StockStatusExportButton({ rows, locations, selectedLocationId }: Props) {
  const handleDownload = () => {
    if (rows.length === 0) {
      toast.error('내보낼 데이터가 없습니다')
      return
    }
    const targetLocations = selectedLocationId
      ? locations.filter((l) => l.id === selectedLocationId)
      : locations
    if (targetLocations.length === 0) {
      toast.error('내보낼 위치가 없습니다')
      return
    }

    const data: (string | number)[][] = []
    let missingMappingCount = 0
    for (const row of rows) {
      for (const loc of targetLocations) {
        const qty = row.byLocation[loc.id]
        if (qty === undefined) continue
        const externalCode = row.externalCodeByLocation[loc.id] ?? ''
        if (!externalCode) missingMappingCount += 1
        data.push([
          row.brandName ?? '',
          row.groupName,
          row.productInternalName ?? row.productName,
          row.optionName,
          row.sku ?? '',
          row.productCode ?? '',
          externalCode,
          loc.name,
          loc.id,
          qty,
          qty,
        ])
      }
    }

    if (data.length === 0) {
      toast.error('해당 조건에 내보낼 셀이 없습니다')
      return
    }

    const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...data])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '재고 현황')
    XLSX.writeFile(wb, `재고현황_${todayYMD()}.xlsx`)

    if (missingMappingCount > 0) {
      toast.warning(
        `${missingMappingCount}건의 셀에 externalCode 매핑이 없어 재고 대조에서 무시됩니다`
      )
    } else {
      toast.success(`${data.length}건을 내보냈습니다`)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleDownload}>
      <Download className="mr-1.5 h-3.5 w-3.5" />
      엑셀 다운로드
    </Button>
  )
}
