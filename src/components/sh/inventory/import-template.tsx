'use client'

import { Button } from '@/components/ui/button'
import * as XLSX from 'xlsx'
import { Download } from 'lucide-react'

export function ImportTemplate() {
  const handleDownload = () => {
    const headers = [
      '날짜',
      '이동타입',
      '상품명',
      '옵션명',
      '수량',
      '제품코드',
      'SKU',
      '위치',
      '도착위치',
      '판매채널',
      '주문일자',
      '사유',
    ]
    const sample = [
      [
        '2026-04-12',
        '입고',
        '예시 상품',
        '옵션A',
        100,
        'PRD-001',
        'SKU-001',
        '창고1',
        '',
        '',
        '',
        '',
      ],
      [
        '2026-04-12',
        '출고',
        '예시 상품',
        '옵션A',
        5,
        '',
        '',
        '창고1',
        '',
        '쿠팡',
        '2026-04-11',
        '',
      ],
      ['2026-04-12', '이동', '예시 상품', '옵션A', 10, '', '', '창고1', '창고2', '', '', ''],
      ['2026-04-12', '조정', '예시 상품', '옵션A', 98, '', '', '창고1', '', '', '', '재고실사'],
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sample])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '재고 이동')
    XLSX.writeFile(wb, '재고이동_템플릿.xlsx')
  }

  return (
    <Button variant="outline" onClick={handleDownload}>
      <Download className="mr-2 h-4 w-4" />
      템플릿 다운로드
    </Button>
  )
}
