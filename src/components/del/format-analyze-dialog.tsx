'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  FIELD_LABELS,
  type DelFieldMapping,
  type DelFormatColumn,
} from '@/lib/del/format-templates'

type AnalyzeResult = {
  headers: string[]
  sampleRows: string[][]
  totalRows: number
  emptyColumns: number[]
  suggestedColumns: DelFormatColumn[]
}

type FormatAnalyzeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (columns: DelFormatColumn[]) => void
}

const NONE_VALUE = '__none__'
const FIELD_OPTIONS = Object.entries(FIELD_LABELS) as [DelFieldMapping, string][]
const SAMPLE_PREVIEW_ROWS = 3

export function FormatAnalyzeDialog({
  open,
  onOpenChange,
  onApply,
}: FormatAnalyzeDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [columns, setColumns] = useState<DelFormatColumn[]>([])

  function reset() {
    setAnalyzing(false)
    setResult(null)
    setColumns([])
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setAnalyzing(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/del/shipping-methods/analyze', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '파일 분석 실패')
      setResult(data as AnalyzeResult)
      setColumns((data as AnalyzeResult).suggestedColumns)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '파일 분석 실패')
      if (inputRef.current) inputRef.current.value = ''
    } finally {
      setAnalyzing(false)
    }
  }

  function updateColumnField(index: number, value: string) {
    const field = value === NONE_VALUE ? null : (value as DelFieldMapping)
    setColumns((prev) =>
      prev.map((col, i) => (i === index ? { ...col, field } : col)),
    )
  }

  function handleApply() {
    if (columns.length === 0) {
      toast.error('적용할 컬럼이 없습니다')
      return
    }
    onApply(columns)
    reset()
  }

  const sampleRows = result?.sampleRows.slice(0, SAMPLE_PREVIEW_ROWS) ?? []

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>양식에서 불러오기</DialogTitle>
          <DialogDescription>
            택배사/3PL 에서 제공한 배송 파일 양식을 업로드하면 컬럼 매핑을 자동으로 추론합니다.
            결과를 확인·수정한 뒤 적용해 주세요.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4 py-4">
            <div className="rounded-md border border-dashed p-8 text-center">
              <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="mb-2 text-sm text-muted-foreground">
                샘플 데이터가 포함된 xlsx/xls 파일을 선택해 주세요
              </p>
              <p className="mb-4 text-xs text-muted-foreground">
                헤더 + 예시 주문 데이터가 있으면 더 정확히 추론됩니다 (최대 10MB)
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                disabled={analyzing}
                className="hidden"
                id="format-analyze-file"
              />
              <Button
                type="button"
                variant="outline"
                disabled={analyzing}
                onClick={() => inputRef.current?.click()}
              >
                {analyzing ? '분석 중...' : '파일 선택'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>총 {result.totalRows}행</span>
              <span>컬럼 {result.headers.length}개</span>
              {result.emptyColumns.length > 0 && (
                <span>빈 컬럼 {result.emptyColumns.length}개</span>
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">파일 미리보기</p>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {result.headers.map((h, i) => (
                        <TableHead key={i} className="whitespace-nowrap">
                          {h || <span className="text-muted-foreground">(빈 헤더)</span>}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sampleRows.map((row, ri) => (
                      <TableRow key={ri}>
                        {result.headers.map((_, ci) => (
                          <TableCell key={ci} className="whitespace-nowrap text-xs">
                            {row[ci] ?? ''}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">자동 매핑 결과 (수정 가능)</p>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">컬럼</TableHead>
                      <TableHead>헤더 텍스트</TableHead>
                      <TableHead className="w-48">매핑 필드</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {columns.map((col, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-center">{col.column}</TableCell>
                        <TableCell className="text-sm">
                          {col.label || <span className="text-muted-foreground">(빈 헤더)</span>}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={col.field ?? NONE_VALUE}
                            onValueChange={(v) => updateColumnField(i, v)}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE_VALUE}>(빈 컬럼)</SelectItem>
                              {FIELD_OPTIONS.map(([key, label]) => (
                                <SelectItem key={key} value={key}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            취소
          </Button>
          {result && (
            <Button onClick={handleApply}>양식 적용하기</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
