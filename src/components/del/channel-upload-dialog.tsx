'use client'

import { useRef, useState } from 'react'
import { Upload, Copy, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { cn } from '@/lib/utils'

type ChannelUploadDialogProps = {
  batchId: string
  shippingMethodId: string
  channelId: string
  onImported: () => void
}

type FieldDef = { value: string; label: string; required?: boolean }

// 매핑 대상 필드(배송 등록 데이터 값). 필드가 먼저고, 파일 컬럼은 여기에 붙인다.
const FIELDS: FieldDef[] = [
  { value: 'recipientName', label: '받는분', required: true },
  { value: 'phone', label: '전화', required: true },
  { value: 'address', label: '주소', required: true },
  { value: 'postalCode', label: '우편번호' },
  { value: 'deliveryMessage', label: '배송메시지' },
  { value: 'orderDate', label: '주문일자' },
  { value: 'orderNumber', label: '주문번호' },
  { value: 'paymentAmount', label: '결제금액' },
  { value: 'productName', label: '상품명' },
  { value: 'productQuantity', label: '수량' },
  { value: 'memo', label: '메모' },
]

const REQUIRED_FIELDS = ['recipientName', 'phone', 'address']

type Preview = {
  headers: string[]
  sampleRows: string[][]
  totalRows: number
}

export function ChannelUploadDialog({
  batchId,
  shippingMethodId,
  channelId,
  onImported,
}: ChannelUploadDialogProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'upload' | 'mapping' | 'done'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  // field → [columnIdx, ...] (여러 컬럼이면 파싱 시 공백으로 결합)
  const [mapping, setMapping] = useState<Record<string, number[]>>({})
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{
    created: number
    errorCount: number
    errors: { row: number; recipientName?: string; message: string }[]
  } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function resetState() {
    setStep('upload')
    setFile(null)
    setPreview(null)
    setMapping({})
    setResult(null)
  }

  async function handleFileUpload(selectedFile: File) {
    setFile(selectedFile)
    const formData = new FormData()
    formData.append('file', selectedFile)

    try {
      const res = await fetch('/api/del/import/preview', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('파일 미리보기 실패')
      const data: Preview = await res.json()
      setPreview(data)

      // 자동 매핑: 헤더 이름 힌트 기반으로 각 필드의 첫 매칭 컬럼 1개 할당
      const hintMap: Record<string, string> = {
        '받는분': 'recipientName', '성명': 'recipientName', '수령인': 'recipientName',
        '전화': 'phone', '전화번호': 'phone', '핸드폰': 'phone', '핸드폰번호': 'phone', '연락처': 'phone',
        '주소': 'address', '총주소': 'address', '받는분주소': 'address',
        '우편번호': 'postalCode', '우편': 'postalCode',
        '배송메시지': 'deliveryMessage', '배송메세지': 'deliveryMessage', '특기사항': 'deliveryMessage', '특이사항': 'deliveryMessage',
        '주문일': 'orderDate', '주문일자': 'orderDate', '결제일': 'orderDate',
        '주문번호': 'orderNumber',
        '결제금액': 'paymentAmount', '금액': 'paymentAmount',
        '품목명': 'productName', '상품명': 'productName', '품목': 'productName',
        '수량': 'productQuantity',
        '메모': 'memo',
      }
      const autoMapping: Record<string, number[]> = {}
      const assigned = new Set<string>()
      data.headers.forEach((header, i) => {
        const field = hintMap[header.trim()]
        if (field && !assigned.has(field)) {
          autoMapping[field] = [i]
          assigned.add(field)
        }
      })
      setMapping(autoMapping)
      setStep('mapping')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '파일 처리 실패')
    }
  }

  function addColumn(field: string, columnIdx: number) {
    setMapping((prev) => {
      const existing = prev[field] ?? []
      if (existing.includes(columnIdx)) return prev
      return { ...prev, [field]: [...existing, columnIdx] }
    })
  }

  function removeColumn(field: string, columnIdx: number) {
    setMapping((prev) => {
      const next = { ...prev }
      const arr = (next[field] ?? []).filter((i) => i !== columnIdx)
      if (arr.length === 0) delete next[field]
      else next[field] = arr
      return next
    })
  }

  async function handleImport() {
    if (!file || !preview) return

    if (REQUIRED_FIELDS.some((f) => (mapping[f]?.length ?? 0) === 0)) {
      toast.error('받는분, 전화, 주소는 필수 매핑입니다')
      return
    }

    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('batchId', batchId)
      formData.append('shippingMethodId', shippingMethodId)
      if (channelId) formData.append('channelId', channelId)
      formData.append('columnMapping', JSON.stringify(mapping))

      const res = await fetch('/api/del/import', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '가져오기 실패')

      setResult({
        created: data.created,
        errorCount: data.errorCount,
        errors: data.errors ?? [],
      })
      setStep('done')
      toast.success(`${data.created}건 가져오기 완료`)
      onImported()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '가져오기 실패')
    } finally {
      setImporting(false)
    }
  }

  const mappedFields = FIELDS.filter((f) => (mapping[f.value]?.length ?? 0) > 0)
  const unmappedFields = FIELDS.filter((f) => (mapping[f.value]?.length ?? 0) === 0)
  const missingRequired = REQUIRED_FIELDS.some((f) => (mapping[f]?.length ?? 0) === 0)
  const usedColumns = new Set<number>(Object.values(mapping).flat())

  function renderFieldRow(field: FieldDef) {
    if (!preview) return null
    const columns = mapping[field.value] ?? []
    const isMissingRequired = field.required && columns.length === 0
    return (
      <div key={field.value} className="flex items-start gap-3 px-3 py-2">
        <div className="w-28 shrink-0 pt-1.5 text-sm">
          <span className={cn(isMissingRequired && 'text-destructive font-medium')}>
            {field.label}
          </span>
          {field.required && <span className="text-destructive ml-0.5">*</span>}
        </div>
        <div className="flex-1 flex flex-wrap items-center gap-1.5">
          {columns.map((colIdx) => (
            <Badge
              key={colIdx}
              variant="secondary"
              className="gap-1 pl-2 pr-1 py-0.5 text-xs font-normal"
            >
              <span>{preview.headers[colIdx] || `컬럼 ${colIdx + 1}`}</span>
              <button
                type="button"
                onClick={() => removeColumn(field.value, colIdx)}
                className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                aria-label={`${preview.headers[colIdx]} 매핑 제거`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Select
            value=""
            onValueChange={(v) => {
              if (v) addColumn(field.value, Number(v))
            }}
          >
            <SelectTrigger
              className={cn(
                'h-7 w-auto min-w-[9rem] text-xs border-dashed',
                isMissingRequired && 'border-destructive/50',
              )}
            >
              <SelectValue
                placeholder={columns.length === 0 ? '+ 파일 컬럼 선택' : '+ 컬럼 추가'}
              />
            </SelectTrigger>
            <SelectContent>
              {preview.headers.map((header, idx) => {
                const inThisField = columns.includes(idx)
                const inOtherField = !inThisField && usedColumns.has(idx)
                return (
                  <SelectItem
                    key={idx}
                    value={String(idx)}
                    disabled={inThisField || inOtherField}
                  >
                    <span className="flex items-center">
                      {header || `컬럼 ${idx + 1}`}
                      {inOtherField && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          (이미 사용됨)
                        </span>
                      )}
                      {inThisField && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          (매핑됨)
                        </span>
                      )}
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          {columns.length > 1 && (
            <span className="text-[11px] text-muted-foreground ml-1">
              공백으로 결합
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) resetState()
        setOpen(v)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="mr-1 h-4 w-4" />파일 업로드
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>채널 파일 업로드</DialogTitle>
          <DialogDescription>
            {step === 'upload' && '주문 내역 파일(Excel/CSV)을 선택해 주세요'}
            {step === 'mapping' && '파일 컬럼을 매핑해 주세요'}
            {step === 'done' && '가져오기가 완료되었습니다'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
        {step === 'upload' && (
          <div
            className="rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const f = e.dataTransfer.files?.[0]
              if (f) handleFileUpload(f)
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFileUpload(f)
              }}
            />
            <Upload className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              파일을 드래그하여 놓거나
            </p>
            <Button variant="outline" className="mt-2" onClick={() => fileRef.current?.click()}>
              파일 선택
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Excel(.xlsx, .xls) 또는 CSV 파일
            </p>
          </div>
        )}

        {step === 'mapping' && preview && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              총 {preview.totalRows}건, 파일: {file?.name}
            </p>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>컬럼 매핑</Label>
                <span className="text-xs text-muted-foreground">
                  필수 항목(<span className="text-destructive">*</span>): 받는분, 전화, 주소
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-medium">매핑 필요</h3>
                  <span className="text-xs text-muted-foreground">
                    ({unmappedFields.length})
                  </span>
                </div>
                {unmappedFields.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-3 rounded-md border border-dashed">
                    모든 필드가 매핑되었습니다
                  </p>
                ) : (
                  <div className="rounded-md border divide-y bg-muted/20">
                    {unmappedFields.map(renderFieldRow)}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-medium">매핑 완료</h3>
                  <span className="text-xs text-muted-foreground">
                    ({mappedFields.length})
                  </span>
                </div>
                {mappedFields.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-3 rounded-md border border-dashed">
                    아직 매핑된 필드가 없습니다
                  </p>
                ) : (
                  <div className="rounded-md border divide-y">
                    {mappedFields.map(renderFieldRow)}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>샘플 데이터</Label>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {preview.headers.map((h, i) => (
                        <TableHead key={i} className="text-xs whitespace-nowrap">
                          {h || `컬럼${i + 1}`}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sampleRows.map((row, i) => (
                      <TableRow key={i}>
                        {row.map((cell, j) => (
                          <TableCell key={j} className="text-xs max-w-[200px] truncate">{cell}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-3 py-2">
            <div className="text-center">
              <p className="text-lg font-medium">{result.created}건 가져오기 완료</p>
              {result.errorCount > 0 && (
                <p className="text-sm text-destructive">{result.errorCount}건 오류</p>
              )}
            </div>

            {result.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">오류 상세</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const tsv = result.errors
                        .map((e) => `행 ${e.row}\t${e.recipientName ?? ''}\t${e.message}`)
                        .join('\n')
                      navigator.clipboard
                        .writeText(`행\t받는분\t오류\n${tsv}`)
                        .then(() => toast.success('오류 목록이 클립보드에 복사되었습니다'))
                        .catch(() => toast.error('복사에 실패했습니다'))
                    }}
                  >
                    <Copy className="mr-1 h-3 w-3" />
                    복사
                  </Button>
                </div>
                <div className="max-h-60 overflow-y-auto rounded-md border bg-muted/30 p-2 space-y-1">
                  {result.errors.map((e, idx) => (
                    <div key={idx} className="text-xs font-mono">
                      <span className="text-muted-foreground">행 {e.row}</span>
                      {e.recipientName && (
                        <span className="ml-2 text-muted-foreground">({e.recipientName})</span>
                      )}
                      <span className="ml-2 text-destructive">{e.message}</span>
                    </div>
                  ))}
                  {result.errorCount > result.errors.length && (
                    <div className="text-xs text-muted-foreground pt-1">
                      ...외 {result.errorCount - result.errors.length}건 더
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        </div>

        <DialogFooter>
          {step === 'mapping' && (
            <div className="flex items-center justify-end gap-3 w-full">
              {missingRequired && (
                <span className="text-xs text-destructive">
                  받는분·전화·주소를 매핑해 주세요
                </span>
              )}
              <Button onClick={handleImport} disabled={importing || missingRequired}>
                {importing ? '가져오는 중...' : `${preview?.totalRows ?? 0}건 가져오기`}
              </Button>
            </div>
          )}
          {step === 'done' && (
            <>
              <Button variant="outline" onClick={resetState}>다른 파일 업로드</Button>
              <Button onClick={() => setOpen(false)}>닫기</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
