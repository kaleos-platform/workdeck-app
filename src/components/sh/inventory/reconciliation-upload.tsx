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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Location = { id: string; name: string; isActive: boolean }

type Props = {
  onUploaded: (reconciliationId: string) => void
}

type Mode = 'file' | 'integration'

export function ReconciliationUpload({ onUploaded }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('file')
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState('')
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    fetch('/api/sh/inventory/locations?isActive=true')
      .then((r) => r.json())
      .then((data) => setLocations(data.locations ?? []))
      .catch(() => toast.error('보관 장소 조회 실패'))
  }, [open])

  function handleSuccess(data: { id: string; totalItems: number; matchedItems: number }) {
    toast.success(`매칭 완료: 총 ${data.totalItems}건 / 자동매칭 ${data.matchedItems}건`)
    setOpen(false)
    setFile(null)
    onUploaded(data.id)
  }

  async function handleFileSubmit() {
    if (!file) return toast.error('파일을 선택해 주세요')
    if (!locationId) return toast.error('보관 장소를 선택해 주세요')

    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('locationId', locationId)
      if (snapshotDate) fd.append('snapshotDate', snapshotDate)

      const res = await fetch('/api/sh/inventory/reconciliation', {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '업로드 실패')

      handleSuccess(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '업로드 실패')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleIntegrationSubmit() {
    if (!locationId) return toast.error('보관 장소를 선택해 주세요')

    setSubmitting(true)
    try {
      const res = await fetch('/api/sh/inventory/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'coupang',
          locationId,
          // 미지정 시 서버가 최신 쿠팡 스냅샷 사용
          ...(snapshotDate ? { snapshotDate } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '연동 실패')

      handleSuccess(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '연동 실패')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Upload className="mr-2 h-4 w-4" /> 재고 대조 시작
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>재고 대조</DialogTitle>
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

          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="file">파일 업로드</TabsTrigger>
              <TabsTrigger value="integration">데이터 연동</TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="space-y-2 pt-2">
              <Label>파일 (xlsx / xls)</Label>
              <Input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                쿠팡 재고 health / 3PL 현재고 / (제품코드+수량) 엑셀 지원
              </p>
            </TabsContent>

            <TabsContent value="integration" className="space-y-2 pt-2">
              <Label>연동 소스</Label>
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">쿠팡 로켓그로스 재고</p>
                <p className="text-xs text-muted-foreground">
                  쿠팡 광고 관리자에서 수집된 최신 재고 스냅샷을 불러와 대조합니다. 기준일을 비우면
                  가장 최근 스냅샷을 사용합니다.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            취소
          </Button>
          <Button
            onClick={mode === 'file' ? handleFileSubmit : handleIntegrationSubmit}
            disabled={submitting}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'file' ? '업로드 및 분석' : '불러와서 대조'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
