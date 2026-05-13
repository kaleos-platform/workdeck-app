'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, FileDown, Package } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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

type SplitMode = 'order' | 'option'

type MethodPreview = {
  shippingMethodId: string
  methodName: string
  splitMode: SplitMode
  totalOrders: number
  totalRows: number
  headers: string[]
  columnFields: { column: string; field: string | null }[]
  sampleRows: Record<string, string | number>[]
}

type BundlePreview = {
  methods: MethodPreview[]
  totalOrders: number
  methodCount: number
}

type DeliveryFileDialogProps = {
  batchId: string
  disabled?: boolean
}

const SAMPLE_LIMIT = 5

export function DeliveryFileDialog({ batchId, disabled }: DeliveryFileDialogProps) {
  const [open, setOpen] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [preview, setPreview] = useState<BundlePreview | null>(null)

  // 다이얼로그 열릴 때 자동으로 preview 요청
  useEffect(() => {
    if (!open) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreviewing(true)
    fetch('/api/sh/shipping/generate-file/bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId, preview: true }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.message ?? '미리보기 실패')
        }
        return (await res.json()) as BundlePreview
      })
      .then((data) => {
        if (!cancelled) setPreview(data)
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : '미리보기 실패')
          setOpen(false)
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, batchId])

  async function handleGenerate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/sh/shipping/generate-file/bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '파일 생성 실패')
      }

      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/)
      const filename = filenameMatch ? decodeURIComponent(filenameMatch[1]) : '배송파일'

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success('배송 파일이 다운로드되었습니다')
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '파일 생성 실패')
    } finally {
      setGenerating(false)
    }
  }

  const totalRows = preview?.methods.reduce((s, m) => s + m.totalRows, 0) ?? 0
  const isMulti = (preview?.methodCount ?? 0) > 1

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <FileDown className="mr-1 h-4 w-4" />
          배송 파일 생성
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>배송 파일 미리보기</DialogTitle>
          <DialogDescription>
            배치 안 주문의 배송 방식별로 파일이 자동 분할됩니다. 단일 방식이면 .xlsx, 2개
            이상이면 .zip 으로 다운로드됩니다.
          </DialogDescription>
        </DialogHeader>

        {previewing && !preview && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            미리보기를 불러오는 중...
          </div>
        )}

        {preview && (
          <div className="space-y-4 py-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                총 주문 <strong className="text-foreground">{preview.totalOrders}건</strong>
              </span>
              <span>·</span>
              <span>
                배송 방식{' '}
                <strong className="text-foreground">{preview.methodCount}개</strong>
              </span>
              <span>·</span>
              <span>
                생성 행 합계 <strong className="text-foreground">{totalRows}행</strong>
              </span>
            </div>

            <div className="max-h-[65vh] space-y-4 overflow-auto pr-1">
              {preview.methods.map((m) => (
                <MethodPreviewCard key={m.shippingMethodId} method={m} />
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={generating}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            취소
          </Button>
          <Button onClick={handleGenerate} disabled={generating || !preview}>
            <FileDown className="mr-1 h-4 w-4" />
            {generating
              ? '생성 중...'
              : isMulti
                ? `전체 ${totalRows}행 다운로드 (.zip)`
                : `전체 ${totalRows}행 다운로드 (.xlsx)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MethodPreviewCard({ method }: { method: MethodPreview }) {
  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
        <Package className="h-3.5 w-3.5 text-muted-foreground" />
        <strong className="text-sm">{method.methodName}</strong>
        <span className="text-muted-foreground">·</span>
        <span>{method.totalOrders}주문 → {method.totalRows}행</span>
        <span className="text-muted-foreground">·</span>
        <span>{method.splitMode === 'option' ? '옵션당 1행' : '주문당 1행'}</span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-xs">#</TableHead>
              {method.headers.map((h, i) => (
                <TableHead key={i} className="text-xs whitespace-nowrap">
                  {h || `컬럼${i + 1}`}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {method.sampleRows.slice(0, SAMPLE_LIMIT).map((row, ri) => (
              <TableRow key={ri}>
                <TableCell className="text-xs text-muted-foreground">{ri + 1}</TableCell>
                {method.columnFields.map((col, ci) => (
                  <TableCell
                    key={ci}
                    className="max-w-[240px] truncate text-xs"
                    title={String(row[col.column] ?? '')}
                  >
                    {String(row[col.column] ?? '')}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {method.sampleRows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={method.headers.length + 1}
                  className="text-center text-xs text-muted-foreground"
                >
                  생성될 행이 없습니다
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {method.totalRows > method.sampleRows.length && (
        <div className="border-t bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
          미리보기 {method.sampleRows.length}행 / 전체 {method.totalRows}행
        </div>
      )}
    </div>
  )
}
