'use client'

import { useState } from 'react'
import { FileDown } from 'lucide-react'
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

type ShippingMethod = { id: string; name: string }

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
  const [generating, setGenerating] = useState(false)

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
        body: JSON.stringify({ batchId, shippingMethodId: selectedMethodId }),
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>배송 파일 생성</DialogTitle>
          <DialogDescription>
            배송 방식을 선택하면 해당 포맷의 Excel 파일을 생성합니다
          </DialogDescription>
        </DialogHeader>

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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button onClick={handleGenerate} disabled={generating || !selectedMethodId}>
            {generating ? '생성 중...' : '파일 생성 및 다운로드'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
