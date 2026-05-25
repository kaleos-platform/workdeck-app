'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

const HEADERS = ['브랜드', '상품명', '옵션명', '위치명', '실재고']

type TemplateRow = {
  brandName: string
  productName: string
  optionName: string
}

function todayYMD() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

export function ReconciliationTemplateDownload() {
  const [loading, setLoading] = useState(false)

  async function handleDownload() {
    setLoading(true)
    try {
      const res = await fetch('/api/sh/inventory/reconciliation/template')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '템플릿 조회 실패')

      const rows: TemplateRow[] = data.rows ?? []
      if (rows.length === 0) {
        toast.error('내보낼 옵션이 없습니다')
        return
      }

      const aoa: (string | number)[][] = [HEADERS]
      for (const r of rows) {
        aoa.push([r.brandName, r.productName, r.optionName, '', ''])
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '재고 조정 템플릿')
      XLSX.writeFile(wb, `재고조정템플릿_${todayYMD()}.xlsx`)
      toast.success(`${rows.length}행 템플릿을 다운로드했습니다`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '템플릿 다운로드 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleDownload} disabled={loading}>
      {loading ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="mr-1.5 h-3.5 w-3.5" />
      )}
      포맷 템플릿 다운로드
    </Button>
  )
}
