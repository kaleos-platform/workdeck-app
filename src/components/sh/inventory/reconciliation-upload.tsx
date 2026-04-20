'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Location = { id: string; name: string; isActive: boolean }

type Props = {
  onUploaded: (reconciliationId: string) => void
}

export function ReconciliationUpload({ onUploaded }: Props) {
  const [open, setOpen] = useState(false)
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState('')
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    fetch('/api/inv/locations?isActive=true')
      .then((r) => r.json())
      .then((data) => setLocations(data.locations ?? []))
      .catch(() => toast.error('보관 장소 조회 실패'))
  }, [open])

  async function handleSubmit() {
    if (!file) return toast.error('파일을 선택해 주세요')
    if (!locationId) return toast.error('보관 장소를 선택해 주세요')

    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('locationId', locationId)
      if (snapshotDate) fd.append('snapshotDate', snapshotDate)

      const res = await fetch('/api/inv/reconciliation', {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '업로드 실패')

      toast.success(`매칭 완료: 총 ${data.totalItems}건 / 자동매칭 ${data.matchedItems}건`)
      setOpen(false)
      setFile(null)
      onUploaded(data.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '업로드 실패')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Upload className="mr-2 h-4 w-4" /> 파일 업로드
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>재고 대조 파일 업로드</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>보관 장소</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger>
                <SelectValue placeholder="보관 장소 선택" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>기준일 (snapshotDate)</Label>
            <Input
              type="date"
              value={snapshotDate}
              onChange={(e) => setSnapshotDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>파일 (xlsx / xls)</Label>
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              쿠팡 재고 health / 3PL 현재고 / (제품코드+수량) 엑셀 지원
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            업로드 및 분석
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
