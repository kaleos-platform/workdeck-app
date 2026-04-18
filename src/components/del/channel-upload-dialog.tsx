'use client'

import { useRef, useState } from 'react'
import { Upload, Copy } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
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

type ChannelUploadDialogProps = {
  batchId: string
  shippingMethodId: string
  channelId: string
  onImported: () => void
}

const FIELD_OPTIONS: { value: string; label: string; required?: boolean }[] = [
  { value: '', label: '(매핑 안 함)' },
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

const NO_MAP = '__none__'

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
  const [mapping, setMapping] = useState<Record<number, string>>({})
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

      // 자동 매핑 시도
      const autoMapping: Record<number, string> = {}
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
      data.headers.forEach((header, i) => {
        const normalized = header.trim()
        if (hintMap[normalized]) {
          autoMapping[i] = hintMap[normalized]
        }
      })
      setMapping(autoMapping)
      setStep('mapping')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '파일 처리 실패')
    }
  }

  async function handleImport() {
    if (!file || !preview) return

    // columnMapping 객체 생성 (field → column index)
    const columnMapping: Record<string, number> = {}
    for (const [idx, field] of Object.entries(mapping)) {
      if (field) columnMapping[field] = Number(idx)
    }

    if (columnMapping.recipientName === undefined || columnMapping.phone === undefined || columnMapping.address === undefined) {
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
      formData.append('columnMapping', JSON.stringify(columnMapping))

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
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              총 {preview.totalRows}건, 파일: {file?.name}
            </p>

            {/* 컬럼 매핑 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>컬럼 매핑</Label>
                <span className="text-xs text-muted-foreground">
                  필수 항목(<span className="text-destructive">*</span>): 받는분, 전화, 주소
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {preview.headers.map((header, i) => {
                  const mappedOpt = FIELD_OPTIONS.find((o) => o.value === mapping[i])
                  const isMappedRequired = mappedOpt?.required
                  return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-sm w-32 truncate" title={header}>
                      {header || `(컬럼 ${i + 1})`}
                    </span>
                    <Select
                      value={mapping[i] || NO_MAP}
                      onValueChange={(v) =>
                        setMapping((prev) => ({ ...prev, [i]: v === NO_MAP ? '' : v }))
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue>
                          {mappedOpt ? (
                            <span>
                              {mappedOpt.label}
                              {isMappedRequired && <span className="text-destructive ml-0.5">*</span>}
                            </span>
                          ) : (
                            '(매핑 안 함)'
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value || NO_MAP} value={opt.value || NO_MAP}>
                            <span className="flex items-center">
                              {opt.label}
                              {opt.required && (
                                <span className="text-destructive ml-1 font-semibold">*</span>
                              )}
                              {opt.required && (
                                <span className="ml-2 rounded bg-destructive/10 text-destructive text-[10px] px-1 py-0.5 font-medium">
                                  필수
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  )
                })}
              </div>
            </div>

            {/* 샘플 미리보기 */}
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
            <>
              <Button variant="outline" onClick={() => setStep('upload')}>이전</Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing ? '가져오는 중...' : `${preview?.totalRows ?? 0}건 가져오기`}
              </Button>
            </>
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
