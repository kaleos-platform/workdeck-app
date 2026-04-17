'use client'

import { useState } from 'react'
import { ClipboardPaste } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { type OrderRow, createEmptyRow } from '@/components/del/registration-table'

type BulkPasteDialogProps = {
  onParsed: (rows: OrderRow[]) => void
}

const EXPECTED_COLUMNS = [
  '받는분', '전화', '주소', '우편번호', '배송메시지',
  '주문일자', '주문번호', '결제금액', '상품명', '수량',
]

export function BulkPasteDialog({ onParsed }: BulkPasteDialogProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<string[][]>([])

  function handleParse() {
    if (!text.trim()) {
      toast.error('데이터를 붙여넣어 주세요')
      return
    }

    const lines = text.trim().split('\n')
    const parsed = lines.map((line) => line.split('\t'))
    setPreview(parsed.slice(0, 10))
  }

  function handleApply() {
    if (preview.length === 0) {
      toast.error('먼저 파싱을 실행해 주세요')
      return
    }

    // 전체 붙여넣기 데이터로 생성
    const allLines = text.trim().split('\n')
    const allRows: OrderRow[] = allLines.map((line) => {
      const cols = line.split('\t')
      const row = createEmptyRow()
      row.recipientName = cols[0] ?? ''
      row.phone = cols[1] ?? ''
      row.address = cols[2] ?? ''
      row.postalCode = cols[3] ?? ''
      row.deliveryMessage = cols[4] ?? ''
      row.orderDate = cols[5] ?? new Date().toISOString().split('T')[0]
      row.orderNumber = cols[6] ?? ''
      row.paymentAmount = cols[7] ?? ''
      const productName = cols[8] ?? ''
      const quantity = Number(cols[9]) || 1
      if (productName) {
        row.items = [{ name: productName, quantity }]
      }
      return row
    })

    onParsed(allRows)
    toast.success(`${allRows.length}건의 주문이 추가되었습니다`)
    setOpen(false)
    setText('')
    setPreview([])
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ClipboardPaste className="mr-1 h-4 w-4" />붙여넣기 대량 입력
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>붙여넣기로 대량 입력</DialogTitle>
          <DialogDescription>
            엑셀에서 복사한 데이터를 아래에 붙여넣으세요. 탭으로 구분된 데이터를 자동으로 파싱합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>컬럼 순서</Label>
            <p className="text-xs text-muted-foreground">
              {EXPECTED_COLUMNS.join(' → ')}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="paste-area">데이터</Label>
            <Textarea
              id="paste-area"
              className="h-40 font-mono text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="엑셀에서 복사한 데이터를 여기에 붙여넣으세요..."
            />
          </div>

          <Button variant="outline" size="sm" onClick={handleParse}>
            미리보기
          </Button>

          {preview.length > 0 && (
            <div className="space-y-2">
              <Label>미리보기 (최대 10행)</Label>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {EXPECTED_COLUMNS.map((col) => (
                        <TableHead key={col} className="text-xs whitespace-nowrap">{col}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((row, i) => (
                      <TableRow key={i}>
                        {EXPECTED_COLUMNS.map((_, j) => (
                          <TableCell key={j} className="text-xs">
                            {row[j] ?? ''}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
          <Button onClick={handleApply} disabled={preview.length === 0}>
            {text.trim().split('\n').length}건 추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
