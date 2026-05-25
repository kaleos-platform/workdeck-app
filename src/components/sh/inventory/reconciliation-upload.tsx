'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plug, UploadCloud, FileSpreadsheet, X } from 'lucide-react'
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
import { COUPANG_ADS_DECK_ID } from '@/lib/deck-routes'
import { cn } from '@/lib/utils'
import { ReconciliationTemplateDownload } from './reconciliation-template-download'

type Location = { id: string; name: string; isActive: boolean }

type CommonProps = {
  onUploaded: (reconciliationId: string) => void
}

function useLocations(open: boolean) {
  const [locations, setLocations] = useState<Location[]>([])
  useEffect(() => {
    if (!open) return
    fetch('/api/sh/inventory/locations?isActive=true')
      .then((r) => r.json())
      .then((data) => setLocations(data.locations ?? []))
      .catch(() => toast.error('보관 장소 조회 실패'))
  }, [open])
  return locations
}

// ───────────────────────── 파일 업로드 ─────────────────────────
export function ReconciliationFileUploadButton({ onUploaded }: CommonProps) {
  const [open, setOpen] = useState(false)
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [file, setFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 2차 다이얼로그(보관 장소 선택) 상태
  const [locationStepOpen, setLocationStepOpen] = useState(false)
  const [locationId, setLocationId] = useState('')
  const locations = useLocations(locationStepOpen)

  function resetAll() {
    setFile(null)
    setLocationId('')
    setLocationStepOpen(false)
  }

  function handleDragOver(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setIsDragOver(true)
  }
  function handleDragLeave() {
    setIsDragOver(false)
  }
  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setIsDragOver(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) setFile(dropped)
  }
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    if (picked) setFile(picked)
  }

  // 서버 응답 분기 헬퍼
  function handleSuccess(data: { id: string; totalItems: number; matchedItems: number }) {
    toast.success(`매칭 완료: 총 ${data.totalItems}건 / 자동매칭 ${data.matchedItems}건`)
    setOpen(false)
    resetAll()
    onUploaded(data.id)
  }

  async function postFile(opts: { locationId?: string }) {
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    if (opts.locationId) fd.append('locationId', opts.locationId)
    if (snapshotDate) fd.append('snapshotDate', snapshotDate)
    const res = await fetch('/api/sh/inventory/reconciliation', {
      method: 'POST',
      body: fd,
    })
    const data = await res.json().catch(() => ({}))
    return { res, data }
  }

  async function handleSubmit() {
    if (!file) return toast.error('파일을 선택해 주세요')
    setSubmitting(true)
    try {
      const result = await postFile({})
      if (!result) return
      const { res, data } = result

      if (res.ok) {
        // stock_status_export 외에는 서버가 single location 강제 — 응답을 받았다는 건 자동 분배 OK
        handleSuccess(data as { id: string; totalItems: number; matchedItems: number })
        return
      }

      // 400 "행에 위치명이 없습니다." → 2차 다이얼로그로 진입
      const msg = typeof data?.message === 'string' ? (data.message as string) : ''
      const needsLocation = res.status === 400 && msg.includes('위치명')
      if (needsLocation) {
        setLocationStepOpen(true)
        return
      }

      throw new Error(msg || '업로드 실패')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '업로드 실패')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLocationStepSubmit() {
    if (!file) return
    if (!locationId) return toast.error('보관 장소를 선택해 주세요')
    setSubmitting(true)
    try {
      const result = await postFile({ locationId })
      if (!result) return
      const { res, data } = result
      if (!res.ok) throw new Error(data?.message ?? '업로드 실패')
      handleSuccess(data as { id: string; totalItems: number; matchedItems: number })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '업로드 실패')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) resetAll()
        }}
      >
        <DialogTrigger asChild>
          <Button>
            <UploadCloud className="mr-2 h-4 w-4" /> 파일 업로드
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>재고 조정 — 파일 업로드</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2 rounded-md border border-dashed bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                포맷이 처음이라면 사전 채워진 템플릿을 받아 <strong>실재고</strong>만 채워 다시
                올리세요.
              </p>
              <ReconciliationTemplateDownload />
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
              <Label>파일</Label>
              <label
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors',
                  isDragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:border-primary/60 hover:bg-muted/40'
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleInputChange}
                />
                {file ? (
                  <div className="flex w-full items-center gap-3 text-left">
                    <FileSpreadsheet className="h-6 w-6 flex-shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        setFile(null)
                        if (fileInputRef.current) fileInputRef.current.value = ''
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="파일 제거"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <UploadCloud className="mb-3 h-10 w-10 text-muted-foreground" />
                    <p className="text-sm font-medium">파일을 드래그하거나 클릭하여 선택</p>
                    <p className="mt-1 text-xs text-muted-foreground">.xlsx (최대 10MB)</p>
                  </>
                )}
              </label>
              <p className="text-xs text-muted-foreground">
                쿠팡 재고 health / 3PL 현재고 / 재고 조정 템플릿 / 재고 현황 내보내기 /
                (제품코드+수량) 엑셀 지원
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              취소
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !file}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              업로드 및 분석
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 2차: 보관 장소 선택 */}
      <Dialog open={locationStepOpen} onOpenChange={setLocationStepOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>보관 장소 선택</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              이 파일은 위치명 컬럼이 없어 자동 분배가 불가합니다. 어느 보관 장소로 반영할지 선택해
              주세요.
            </p>
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
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLocationStepOpen(false)}
              disabled={submitting}
            >
              취소
            </Button>
            <Button onClick={handleLocationStepSubmit} disabled={submitting || !locationId}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              선택 후 분석
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ───────────────────────── 데이터 연동 ─────────────────────────
export function ReconciliationIntegrationButton({ onUploaded }: CommonProps) {
  const [open, setOpen] = useState(false)
  const [locationId, setLocationId] = useState('')
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [submitting, setSubmitting] = useState(false)
  const [coupangActive, setCoupangActive] = useState<boolean | null>(null)
  const locations = useLocations(open)

  useEffect(() => {
    if (!open) return
    fetch('/api/spaces')
      .then((r) => r.json())
      .then((data) => {
        const decks: { id: string }[] = data?.space?.activeDecks ?? []
        setCoupangActive(decks.some((d) => d.id === COUPANG_ADS_DECK_ID))
      })
      .catch(() => setCoupangActive(false))
  }, [open])

  async function handleSubmit() {
    if (coupangActive === false) {
      return toast.error('쿠팡 광고 관리자 Deck을 먼저 연동해 주세요')
    }
    if (!locationId) return toast.error('보관 장소를 선택해 주세요')

    setSubmitting(true)
    try {
      const res = await fetch('/api/sh/inventory/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'coupang',
          locationId,
          ...(snapshotDate ? { snapshotDate } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '연동 실패')

      toast.success(`매칭 완료: 총 ${data.totalItems}건 / 자동매칭 ${data.matchedItems}건`)
      setOpen(false)
      onUploaded(data.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '연동 실패')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plug className="mr-2 h-4 w-4" /> 데이터 연동
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>재고 조정 — 데이터 연동</DialogTitle>
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
            <Label>연동 소스</Label>
            {coupangActive === false ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  쿠팡 광고 관리자 미사용 중
                </p>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                  이 연동을 사용하려면 먼저 <strong>쿠팡 광고 관리자</strong> Deck을 연동해야
                  합니다. 공간 설정에서 쿠팡 광고 관리자를 추가한 뒤 재고를 수집하면 이곳에서 불러올
                  수 있습니다.
                </p>
              </div>
            ) : (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">쿠팡 로켓그로스 재고</p>
                <p className="text-xs text-muted-foreground">
                  쿠팡 광고 관리자에서 수집된 최신 재고 스냅샷을 불러와 대조합니다. 기준일을 비우면
                  가장 최근 스냅샷을 사용합니다.
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || coupangActive === false}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            불러와서 대조
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
