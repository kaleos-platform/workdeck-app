'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, Eye, FileDown } from 'lucide-react'
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
import { cn } from '@/lib/utils'

type PreviewData = {
  headers: string[]
  rows: Record<string, string | number>[]
  columnFields: { column: string; field: string | null }[]
  previewOrderCount: number
  totalOrders: number
  splitMode: 'order' | 'option'
}

type SplitMode = 'order' | 'option'
type ShippingMethod = { id: string; name: string; defaultSplitMode?: SplitMode }

type DeliveryFileDialogProps = {
  batchId: string
  shippingMethods: ShippingMethod[]
  disabled?: boolean
}

const NO_VALUE = '__none__'

export function DeliveryFileDialog({
  batchId,
  shippingMethods,
  disabled,
}: DeliveryFileDialogProps) {
  const [open, setOpen] = useState(false)
  const [selectedMethodId, setSelectedMethodId] = useState('')
  const [splitMode, setSplitMode] = useState<SplitMode>('order')
  const [generating, setGenerating] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<PreviewData | null>(null)

  // 배송 방식이 변경되면 해당 방식의 기본값으로 splitMode 갱신 (사용자는 이후 수동 변경 가능)
  useEffect(() => {
    if (!selectedMethodId) return
    const method = shippingMethods.find((m) => m.id === selectedMethodId)
    if (method?.defaultSplitMode) {
      setSplitMode(method.defaultSplitMode)
    }
  }, [selectedMethodId, shippingMethods])

  // 다이얼로그가 닫히면 preview 초기화 (다음 open 시 깨끗한 상태)
  useEffect(() => {
    if (!open) setPreview(null)
  }, [open])

  async function handlePreview() {
    if (!selectedMethodId) {
      toast.error('배송 방식을 선택해 주세요')
      return
    }
    setPreviewing(true)
    try {
      const res = await fetch('/api/sh/shipping/generate-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          shippingMethodId: selectedMethodId,
          splitMode,
          preview: true,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '미리보기 실패')
      }
      const data: PreviewData = await res.json()
      setPreview(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '미리보기 실패')
    } finally {
      setPreviewing(false)
    }
  }

  async function handleGenerate() {
    if (!selectedMethodId) {
      toast.error('배송 방식을 선택해 주세요')
      return
    }

    setGenerating(true)
    try {
      const res = await fetch('/api/sh/shipping/generate-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, shippingMethodId: selectedMethodId, splitMode }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '파일 생성 실패')
      }

      // 파일 다운로드
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/)
      const filename = filenameMatch ? decodeURIComponent(filenameMatch[1]) : '배송파일.xlsx'

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <FileDown className="mr-1 h-4 w-4" />
          배송 파일 생성
        </Button>
      </DialogTrigger>
      <DialogContent className={preview ? 'max-w-[90vw]' : undefined}>
        <DialogHeader>
          <DialogTitle>{preview ? '배송 파일 미리보기' : '배송 파일 생성'}</DialogTitle>
          <DialogDescription>
            {preview
              ? `처음 ${preview.previewOrderCount}건의 주문으로 생성된 파일 미리보기입니다. 문제없으면 다운로드를 눌러주세요.`
              : '배송 방식을 선택하고 미리보기에서 포맷을 확인한 뒤 Excel로 다운로드합니다'}
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>배송 방식</Label>
              <Select
                value={selectedMethodId || NO_VALUE}
                onValueChange={(v) => setSelectedMethodId(v === NO_VALUE ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="배송 방식 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VALUE}>선택</SelectItem>
                  {shippingMethods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>파일 구성</Label>
              <div className="space-y-2">
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-md border p-3 transition',
                    splitMode === 'order' ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                  )}
                >
                  <input
                    type="radio"
                    name="splitMode"
                    value="order"
                    checked={splitMode === 'order'}
                    onChange={() => setSplitMode('order')}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">주문당 1행 (상품 묶음 텍스트)</p>
                    <p className="text-xs text-muted-foreground">
                      1 주문 = 1 행. 상품명 컬럼에 모든 옵션을 concat. 일반 택배사·쇼핑몰 포맷.
                    </p>
                  </div>
                </label>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-md border p-3 transition',
                    splitMode === 'option' ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                  )}
                >
                  <input
                    type="radio"
                    name="splitMode"
                    value="option"
                    checked={splitMode === 'option'}
                    onChange={() => setSplitMode('option')}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">옵션당 1행 (개별 상품 행)</p>
                    <p className="text-xs text-muted-foreground">
                      옵션 1개 = 1 행. 수취인 정보가 반복됨. 3PL·물류센터 포맷.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                총 주문 <strong className="text-foreground">{preview.totalOrders}건</strong>
              </span>
              <span>·</span>
              <span>
                미리보기 {preview.previewOrderCount}건 → {preview.rows.length}행
              </span>
              <span>·</span>
              <span>
                포맷:{' '}
                <strong className="text-foreground">
                  {preview.splitMode === 'order' ? '주문당 1행' : '옵션당 1행'}
                </strong>
              </span>
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
                  <TableRow>
                    <TableHead className="w-10 text-xs">#</TableHead>
                    {preview.headers.map((h, i) => (
                      <TableHead key={i} className="text-xs whitespace-nowrap">
                        {h || `컬럼${i + 1}`}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row, ri) => (
                    <TableRow key={ri}>
                      <TableCell className="text-xs text-muted-foreground">{ri + 1}</TableCell>
                      {preview.columnFields.map((col, ci) => (
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
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          {preview ? (
            <>
              <Button variant="outline" onClick={() => setPreview(null)} disabled={generating}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                다시 설정
              </Button>
              <Button onClick={handleGenerate} disabled={generating}>
                <FileDown className="mr-1 h-4 w-4" />
                {generating ? '생성 중...' : `전체 ${preview.totalOrders}건 다운로드`}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                취소
              </Button>
              <Button onClick={handlePreview} disabled={previewing || !selectedMethodId}>
                <Eye className="mr-1 h-4 w-4" />
                {previewing ? '불러오는 중...' : '미리보기'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
