'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  BookmarkPlus,
  Copy,
  Info,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { cn } from '@/lib/utils'

// ---------- 상수 ----------

type FieldDef = { value: string; label: string; required?: boolean }

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

const HINT_MAP: Record<string, string> = {
  받는분: 'recipientName',
  성명: 'recipientName',
  수령인: 'recipientName',
  전화: 'phone',
  전화번호: 'phone',
  핸드폰: 'phone',
  핸드폰번호: 'phone',
  연락처: 'phone',
  주소: 'address',
  총주소: 'address',
  받는분주소: 'address',
  우편번호: 'postalCode',
  우편: 'postalCode',
  배송메시지: 'deliveryMessage',
  배송메세지: 'deliveryMessage',
  특기사항: 'deliveryMessage',
  특이사항: 'deliveryMessage',
  주문일: 'orderDate',
  주문일자: 'orderDate',
  결제일: 'orderDate',
  주문번호: 'orderNumber',
  결제금액: 'paymentAmount',
  금액: 'paymentAmount',
  품목명: 'productName',
  상품명: 'productName',
  품목: 'productName',
  수량: 'productQuantity',
  메모: 'memo',
}

// ---------- 타입 ----------

type Preview = {
  headers: string[]
  sampleRows: string[][]
  totalRows: number
  emptyColumns: number[]
}

type ImportResult = {
  created: number
  errorCount: number
  errors: { row: number; recipientName?: string; message: string }[]
}

type Draft = {
  fileName: string
  fileBase64?: string
  preview: Preview
  mapping: Record<string, number[]>
}

// ---------- 프리셋 타입 ----------

type PresetMappingEntry = { headerName: string; field: string }

type Preset = {
  id: string
  name: string
  mapping: PresetMappingEntry[]
  updatedAt: string
}

type PresetApplyResult = {
  mapping: Record<string, number[]>
  matched: number
  total: number
  missingHeaders: string[] // preset에 있지만 파일에 없는 header
}

// preset의 header name → field 매핑을 현재 파일 headers에 적용
function applyPreset(preset: PresetMappingEntry[], headers: string[]): PresetApplyResult {
  const headerIndexMap = new Map<string, number>()
  headers.forEach((h, i) => {
    const normalized = h.trim()
    if (normalized && !headerIndexMap.has(normalized)) {
      headerIndexMap.set(normalized, i)
    }
  })

  const mapping: Record<string, number[]> = {}
  const missingHeaders: string[] = []
  let matched = 0

  for (const entry of preset) {
    const idx = headerIndexMap.get(entry.headerName)
    if (idx !== undefined) {
      const existing = mapping[entry.field] ?? []
      if (!existing.includes(idx)) {
        mapping[entry.field] = [...existing, idx]
      }
      matched++
    } else {
      missingHeaders.push(entry.headerName)
    }
  }

  return { mapping, matched, total: preset.length, missingHeaders }
}

// 현재 mapping + headers → 저장용 preset 매핑 배열로 변환
function mappingToPresetEntries(
  mapping: Record<string, number[]>,
  headers: string[]
): PresetMappingEntry[] {
  const entries: PresetMappingEntry[] = []
  for (const [field, indices] of Object.entries(mapping)) {
    for (const idx of indices) {
      const headerName = headers[idx]?.trim()
      if (headerName) {
        entries.push({ headerName, field })
      }
    }
  }
  return entries
}

// ---------- 유틸 ----------

function draftKey(batchId: string) {
  return `del:upload:${batchId}`
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error ?? new Error('파일 읽기 실패'))
    r.readAsDataURL(file)
  })
}

function dataUrlToFile(url: string, name: string): File {
  const [meta, b64] = url.split(',')
  const mime = /:(.+);/.exec(meta ?? '')?.[1] ?? 'application/octet-stream'
  const bin = atob(b64 ?? '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: mime })
}

function autoMap(preview: Preview): Record<string, number[]> {
  const result: Record<string, number[]> = {}
  const assigned = new Set<string>()
  const empty = new Set(preview.emptyColumns ?? [])
  preview.headers.forEach((header, i) => {
    if (empty.has(i)) return
    const field = HINT_MAP[header.trim()]
    if (field && !assigned.has(field)) {
      result[field] = [i]
      assigned.add(field)
    }
  })
  return result
}

// ---------- 페이지 ----------

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">로딩 중...</div>}>
      <UploadPageInner />
    </Suspense>
  )
}

function UploadPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const batchId = searchParams.get('batchId') ?? ''

  const [shippingMethodId, setShippingMethodId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mapping, setMapping] = useState<Record<string, number[]>>({})
  const [fileMissing, setFileMissing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [hoveredColumnIdx, setHoveredColumnIdx] = useState<number | null>(null)
  const [errorDialog, setErrorDialog] = useState<{ open: boolean } & ImportResult>({
    open: false,
    created: 0,
    errorCount: 0,
    errors: [],
  })

  // 프리셋 관련 상태
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetMismatch, setPresetMismatch] = useState<{
    presetName: string
    matched: number
    total: number
    missingHeaders: string[]
  } | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const draftLoadedRef = useRef(false)

  // batchId 필수 — 없으면 배송 등록으로 리다이렉트
  useEffect(() => {
    if (!batchId) router.replace('/d/seller-hub/shipping/registration')
  }, [batchId, router])

  // 프리셋 목록 로드
  const loadPresets = useCallback(async () => {
    try {
      const res = await fetch('/api/sh/shipping/column-mapping-presets')
      if (res.ok) {
        const data = await res.json()
        setPresets(data.presets ?? [])
      }
    } catch {
      // 조용히 실패
    }
  }, [])

  // 프리셋 적용
  function handleApplyPreset(preset: Preset) {
    if (!preview) return
    const result = applyPreset(preset.mapping, preview.headers)
    setMapping(result.mapping)

    if (result.matched < result.total) {
      setPresetMismatch({
        presetName: preset.name,
        matched: result.matched,
        total: result.total,
        missingHeaders: result.missingHeaders,
      })
    } else {
      setPresetMismatch(null)
      toast.success(`프리셋 "${preset.name}" 적용 완료`)
    }
  }

  // 프리셋 저장
  async function handleSavePreset(name: string) {
    if (!preview) return
    const entries = mappingToPresetEntries(mapping, preview.headers)
    if (entries.length === 0) {
      toast.error('저장할 매핑이 없습니다')
      return
    }

    try {
      const res = await fetch('/api/sh/shipping/column-mapping-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mapping: entries }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '저장 실패')
      }
      toast.success(`프리셋 "${name}" 저장 완료`)
      await loadPresets()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '프리셋 저장 실패')
    }
  }

  // 초기 로드: 활성 배송방식 가져오기 + sessionStorage 복원 + 프리셋
  useEffect(() => {
    if (!batchId) return

    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/sh/shipping/shipping-methods?isActive=true')
        const data = await res.json()
        if (!cancelled) {
          const first = (data.methods ?? [])[0]?.id
          if (first) setShippingMethodId(first)
        }
      } catch {
        // 조용히 실패 — 가져오기 시점에 다시 체크
      }
    })()

    void loadPresets()

    // draft 복원
    try {
      const raw = sessionStorage.getItem(draftKey(batchId))
      if (raw) {
        const draft: Draft = JSON.parse(raw)
        setPreview(draft.preview)
        setMapping(draft.mapping ?? {})
        if (draft.fileBase64) {
          setFile(dataUrlToFile(draft.fileBase64, draft.fileName))
        } else {
          setFileMissing(true)
        }
      }
    } catch {
      // 손상된 draft 는 무시
    }
    draftLoadedRef.current = true

    return () => {
      cancelled = true
    }
  }, [batchId, loadPresets])

  // mapping 변경 시 draft 갱신 (debounce)
  useEffect(() => {
    if (!batchId || !preview || !draftLoadedRef.current) return
    const t = setTimeout(() => {
      saveDraft(batchId, { file, preview, mapping })
    }, 300)
    return () => clearTimeout(t)
  }, [batchId, file, preview, mapping])

  async function handleFileUpload(selectedFile: File) {
    setFile(selectedFile)
    setFileMissing(false)
    const formData = new FormData()
    formData.append('file', selectedFile)
    try {
      const res = await fetch('/api/sh/shipping/import/preview', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('파일 미리보기 실패')
      const data: Preview = await res.json()
      setPreview(data)
      const auto = autoMap(data)
      setMapping(auto)

      // 즉시 저장 (아직 mapping effect debounce 안 탈 수 있으므로)
      await saveDraft(batchId, { file: selectedFile, preview: data, mapping: auto })
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

  function clearAll() {
    setFile(null)
    setPreview(null)
    setMapping({})
    setFileMissing(false)
    setErrorDialog({ open: false, created: 0, errorCount: 0, errors: [] })
    try {
      sessionStorage.removeItem(draftKey(batchId))
    } catch {
      // 무시
    }
  }

  function handleDeleteDraft() {
    if (!confirm('임시저장된 업로드 내역을 삭제하시겠습니까? 복구할 수 없습니다.')) return
    clearAll()
    toast.success('임시저장이 삭제되었습니다')
    router.push('/d/seller-hub/shipping/registration')
  }

  async function handleImport() {
    if (!file || !preview) {
      toast.error('파일을 다시 선택해 주세요')
      return
    }
    if (REQUIRED_FIELDS.some((f) => (mapping[f]?.length ?? 0) === 0)) {
      toast.error('받는분, 전화, 주소는 필수 매핑입니다')
      return
    }

    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('batchId', batchId)
      if (shippingMethodId) formData.append('shippingMethodId', shippingMethodId)
      formData.append('columnMapping', JSON.stringify(mapping))

      const res = await fetch('/api/sh/shipping/import', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '가져오기 실패')

      if (data.errorCount === 0) {
        // 완전 성공 → 임시저장 삭제 후 registration 으로 이동
        try {
          sessionStorage.removeItem(draftKey(batchId))
        } catch {
          // 무시
        }
        toast.success(`${data.created}건 가져오기 완료`)
        router.push(`/d/seller-hub/shipping/registration?imported=${data.created}`)
        return
      }

      // 실패 또는 부분 성공 → 현재 페이지에 머물고 Dialog 로 안내
      setErrorDialog({
        open: true,
        created: data.created,
        errorCount: data.errorCount,
        errors: data.errors ?? [],
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '가져오기 실패')
    } finally {
      setImporting(false)
    }
  }

  // ---------- 파생 ----------

  const mappedFieldCount = FIELDS.filter((f) => (mapping[f.value]?.length ?? 0) > 0).length
  const missingRequired = REQUIRED_FIELDS.some((f) => (mapping[f]?.length ?? 0) === 0)
  const usedColumnSet = new Set<number>(Object.values(mapping).flat())
  const emptyColumnSet = new Set<number>(preview?.emptyColumns ?? [])
  const unusedColumns = preview
    ? preview.headers
        .map((h, i) => ({ header: h || `컬럼${i + 1}`, idx: i }))
        .filter(({ idx }) => !emptyColumnSet.has(idx) && !usedColumnSet.has(idx))
    : []

  const hasDraft = preview !== null

  // ---------- 렌더 ----------

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 상단 바 */}
      <header className="flex shrink-0 items-center justify-between border-b bg-background px-6 py-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8">
            <Link href="/d/seller-hub/shipping/registration">
              <ArrowLeft className="mr-1 h-4 w-4" />
              배송 등록
            </Link>
          </Button>
          <div className="h-5 w-px bg-border" />
          <h1 className="text-base font-semibold">채널 파일 업로드</h1>
          {preview && (
            <span className="text-xs text-muted-foreground">
              · 파일: {file?.name ?? '(재업로드 필요)'} · 총 {preview.totalRows}건
            </span>
          )}
        </div>
        {hasDraft && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDeleteDraft}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              임시저장 삭제
            </Button>
            <Button variant="outline" size="sm" onClick={clearAll}>
              <Upload className="mr-1 h-4 w-4" />
              다른 파일 업로드
            </Button>
          </div>
        )}
      </header>

      {/* 본문 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!preview ? (
          <UploadView onFile={handleFileUpload} fileRef={fileRef} />
        ) : (
          <MappingView
            preview={preview}
            mapping={mapping}
            addColumn={addColumn}
            removeColumn={removeColumn}
            hoveredColumnIdx={hoveredColumnIdx}
            setHoveredColumnIdx={setHoveredColumnIdx}
            usedColumnSet={usedColumnSet}
            emptyColumnSet={emptyColumnSet}
            unusedColumns={unusedColumns}
            fileMissing={fileMissing}
            onPickFile={() => fileRef.current?.click()}
            presets={presets}
            onApplyPreset={handleApplyPreset}
            onSavePreset={handleSavePreset}
            presetMismatch={presetMismatch}
            onDismissMismatch={() => setPresetMismatch(null)}
          />
        )}
      </div>

      {/* 스티키 푸터 */}
      {preview && (
        <footer className="flex shrink-0 items-center justify-between border-t bg-background px-6 py-3">
          <span className="text-xs text-muted-foreground">
            매핑 완료 {mappedFieldCount} / {FIELDS.length}
          </span>
          <div className="flex items-center gap-3">
            {missingRequired && (
              <span className="text-xs text-destructive">받는분·전화·주소를 매핑해 주세요</span>
            )}
            {fileMissing && (
              <span className="text-xs text-destructive">파일을 다시 선택해 주세요</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/d/seller-hub/shipping/registration')}
            >
              취소
            </Button>
            <Button onClick={handleImport} disabled={importing || missingRequired || fileMissing}>
              {importing ? '가져오는 중...' : `${preview.totalRows}건 가져오기`}
            </Button>
          </div>
        </footer>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFileUpload(f)
          e.target.value = ''
        }}
      />

      <ImportErrorDialog
        state={errorDialog}
        onClose={() => setErrorDialog((prev) => ({ ...prev, open: false }))}
        onReset={() => {
          setErrorDialog((prev) => ({ ...prev, open: false }))
          clearAll()
        }}
      />
    </div>
  )
}

// ---------- draft 저장 ----------

async function saveDraft(
  batchId: string,
  state: { file: File | null; preview: Preview; mapping: Record<string, number[]> }
) {
  if (!batchId) return
  const key = draftKey(batchId)
  try {
    const base: Omit<Draft, 'fileBase64'> = {
      fileName: state.file?.name ?? '',
      preview: state.preview,
      mapping: state.mapping,
    }
    if (state.file) {
      const fileBase64 = await fileToDataUrl(state.file)
      sessionStorage.setItem(key, JSON.stringify({ ...base, fileBase64 }))
    } else {
      sessionStorage.setItem(key, JSON.stringify(base))
    }
  } catch (err) {
    // 용량 초과 등 — 파일 제외하고 mapping/preview 만 저장 시도
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          fileName: state.file?.name ?? '',
          preview: state.preview,
          mapping: state.mapping,
        })
      )
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        toast.message(
          '파일이 너무 커 매핑만 저장됩니다. 페이지를 나갔다 오면 파일 재업로드가 필요합니다.'
        )
      }
    } catch {
      // 아예 저장 불가 — 무시
    }
  }
}

// ---------- 업로드 단계 ----------

function UploadView({
  onFile,
  fileRef,
}: {
  onFile: (file: File) => void
  fileRef: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div
        className="w-full max-w-2xl rounded-lg border-2 border-dashed p-12 text-center transition-colors hover:border-primary/50"
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const f = e.dataTransfer.files?.[0]
          if (f) onFile(f)
        }}
      >
        <Upload className="mx-auto h-12 w-12 text-muted-foreground/50" />
        <p className="mt-4 text-sm text-muted-foreground">파일을 드래그하여 놓거나</p>
        <Button variant="outline" className="mt-3" onClick={() => fileRef.current?.click()}>
          파일 선택
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">Excel(.xlsx, .xls) 또는 CSV 파일</p>
      </div>
    </div>
  )
}

// ---------- 매핑 단계 ----------

type MappingViewProps = {
  preview: Preview
  mapping: Record<string, number[]>
  addColumn: (field: string, idx: number) => void
  removeColumn: (field: string, idx: number) => void
  hoveredColumnIdx: number | null
  setHoveredColumnIdx: (v: number | null) => void
  usedColumnSet: Set<number>
  emptyColumnSet: Set<number>
  unusedColumns: { header: string; idx: number }[]
  fileMissing: boolean
  onPickFile: () => void
  presets: Preset[]
  onApplyPreset: (preset: Preset) => void
  onSavePreset: (name: string) => Promise<void>
  presetMismatch: {
    presetName: string
    matched: number
    total: number
    missingHeaders: string[]
  } | null
  onDismissMismatch: () => void
}

function MappingView(p: MappingViewProps) {
  const {
    preview,
    mapping,
    addColumn,
    removeColumn,
    hoveredColumnIdx,
    setHoveredColumnIdx,
    usedColumnSet,
    emptyColumnSet,
    unusedColumns,
    fileMissing,
    onPickFile,
    presets,
    onApplyPreset,
    onSavePreset,
    presetMismatch,
    onDismissMismatch,
  } = p

  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!presetName.trim()) return
    setSaving(true)
    try {
      await onSavePreset(presetName.trim())
      setSaveDialogOpen(false)
      setPresetName('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-6 py-5">
      {fileMissing && (
        <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-destructive" />
            <span>
              매핑 상태는 복원되었습니다. 가져오기를 완료하려면 원본 파일을 다시 선택해 주세요.
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={onPickFile}>
            파일 다시 선택
          </Button>
        </div>
      )}

      {/* 프리셋 partial match 안내 배너 */}
      {presetMismatch && (
        <div className="flex items-start justify-between rounded-md border border-amber-400/40 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p>
                프리셋 &quot;{presetMismatch.presetName}&quot;이 부분 적용되었습니다 (
                {presetMismatch.matched}/{presetMismatch.total}개 컬럼 일치).
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                파일에 없는 컬럼: {presetMismatch.missingHeaders.join(', ')}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="ml-2 shrink-0" onClick={onDismissMismatch}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* 프리셋 선택/저장 영역 */}
      <section className="flex flex-wrap items-center gap-2">
        {presets.length > 0 && (
          <Select
            value=""
            onValueChange={(v) => {
              const preset = presets.find((p) => p.id === v)
              if (preset) onApplyPreset(preset)
            }}
          >
            <SelectTrigger className="h-8 w-auto min-w-[12rem] text-xs">
              <SelectValue placeholder="저장된 프리셋 적용..." />
            </SelectTrigger>
            <SelectContent>
              {presets.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            setPresetName('')
            setSaveDialogOpen(true)
          }}
        >
          <BookmarkPlus className="mr-1 h-3.5 w-3.5" />
          현재 매핑 저장
        </Button>
      </section>

      {/* 프리셋 저장 다이얼로그 */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>컬럼 매핑 프리셋 저장</DialogTitle>
            <DialogDescription>
              현재 매핑을 이름을 지정하여 저장합니다. 같은 이름이 있으면 덮어씁니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="preset-name">프리셋 이름</Label>
            <Input
              id="preset-name"
              placeholder="예: 쿠팡 주문서"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && presetName.trim()) handleSave()
              }}
              maxLength={100}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              취소
            </Button>
            <Button onClick={handleSave} disabled={!presetName.trim() || saving}>
              <Save className="mr-1 h-4 w-4" />
              {saving ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 매핑 섹션 */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <Label className="text-sm">컬럼 매핑</Label>
            <span className="text-xs text-muted-foreground">
              매핑 완료 {FIELDS.filter((f) => (mapping[f.value]?.length ?? 0) > 0).length} /{' '}
              {FIELDS.length}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            필수 항목(<span className="text-destructive">*</span>): 받는분, 전화, 주소
          </span>
        </div>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border bg-border md:grid-cols-2">
          {FIELDS.map((field) => (
            <div key={field.value} className="bg-background">
              <FieldRow
                field={field}
                preview={preview}
                columns={mapping[field.value] ?? []}
                usedColumnSet={usedColumnSet}
                emptyColumnSet={emptyColumnSet}
                hoveredColumnIdx={hoveredColumnIdx}
                setHoveredColumnIdx={setHoveredColumnIdx}
                onAdd={(idx) => addColumn(field.value, idx)}
                onRemove={(idx) => removeColumn(field.value, idx)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* 샘플 섹션 */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Label className="text-sm">샘플 데이터</Label>
          <span className="text-xs text-muted-foreground">
            총 {preview.totalRows}건 · {preview.sampleRows.length}개 행 미리보기
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">사용하지 않은 컬럼 ({unusedColumns.length})</span>
          {unusedColumns.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">— 모든 컬럼을 매핑했습니다</span>
          ) : (
            unusedColumns.map(({ header, idx }) => (
              <Badge
                key={idx}
                variant="outline"
                className={cn(
                  'text-[11px] font-normal text-muted-foreground transition-colors',
                  hoveredColumnIdx === idx && 'bg-primary/10 text-foreground'
                )}
                onMouseEnter={() => setHoveredColumnIdx(idx)}
                onMouseLeave={() => setHoveredColumnIdx(null)}
              >
                {header}
              </Badge>
            ))
          )}
        </div>

        <div className="overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
              <TableRow>
                {preview.headers.map((h, i) => {
                  const dimmed = !usedColumnSet.has(i)
                  const empty = emptyColumnSet.has(i)
                  return (
                    <TableHead
                      key={i}
                      className={cn(
                        'text-xs whitespace-nowrap transition-colors',
                        dimmed && 'text-muted-foreground opacity-60',
                        empty && 'italic opacity-40',
                        hoveredColumnIdx === i && 'bg-primary/15 text-foreground opacity-100'
                      )}
                      onMouseEnter={() => setHoveredColumnIdx(i)}
                      onMouseLeave={() => setHoveredColumnIdx(null)}
                    >
                      {h || `컬럼${i + 1}`}
                    </TableHead>
                  )
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.sampleRows.map((row, ri) => (
                <TableRow key={ri}>
                  {row.map((cell, ci) => {
                    const dimmed = !usedColumnSet.has(ci)
                    const empty = emptyColumnSet.has(ci)
                    return (
                      <TableCell
                        key={ci}
                        title={cell}
                        className={cn(
                          'max-w-[240px] truncate text-xs transition-colors',
                          dimmed && 'text-muted-foreground opacity-60',
                          empty && 'italic opacity-40',
                          hoveredColumnIdx === ci && 'bg-primary/10 text-foreground opacity-100'
                        )}
                        onMouseEnter={() => setHoveredColumnIdx(ci)}
                        onMouseLeave={() => setHoveredColumnIdx(null)}
                      >
                        {cell}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

// ---------- 필드 행 ----------

type FieldRowProps = {
  field: FieldDef
  preview: Preview
  columns: number[]
  usedColumnSet: Set<number>
  emptyColumnSet: Set<number>
  hoveredColumnIdx: number | null
  setHoveredColumnIdx: (v: number | null) => void
  onAdd: (idx: number) => void
  onRemove: (idx: number) => void
}

function FieldRow({
  field,
  preview,
  columns,
  usedColumnSet,
  emptyColumnSet,
  hoveredColumnIdx,
  setHoveredColumnIdx,
  onAdd,
  onRemove,
}: FieldRowProps) {
  const isMissingRequired = field.required && columns.length === 0
  return (
    <div className="flex items-start gap-3 px-3 py-2">
      <div className="w-28 shrink-0 pt-1.5 text-sm">
        <span className={cn(isMissingRequired && 'font-medium text-destructive')}>
          {field.label}
        </span>
        {field.required && <span className="ml-0.5 text-destructive">*</span>}
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {columns.map((colIdx) => (
          <Badge
            key={colIdx}
            variant="secondary"
            className={cn(
              'gap-1 py-0.5 pr-1 pl-2 text-xs font-normal transition-colors',
              hoveredColumnIdx === colIdx && 'bg-primary/20 ring-1 ring-primary/40'
            )}
            onMouseEnter={() => setHoveredColumnIdx(colIdx)}
            onMouseLeave={() => setHoveredColumnIdx(null)}
          >
            <span>{preview.headers[colIdx] || `컬럼 ${colIdx + 1}`}</span>
            <button
              type="button"
              onClick={() => onRemove(colIdx)}
              className="rounded-full p-0.5 hover:bg-muted-foreground/20"
              aria-label={`${preview.headers[colIdx]} 매핑 제거`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Select
          value=""
          onValueChange={(v) => {
            if (v) onAdd(Number(v))
          }}
        >
          <SelectTrigger
            className={cn(
              'h-7 w-auto min-w-[9rem] border-dashed text-xs',
              isMissingRequired && 'border-destructive/50'
            )}
          >
            <SelectValue placeholder={columns.length === 0 ? '+ 파일 컬럼 선택' : '+ 컬럼 추가'} />
          </SelectTrigger>
          <SelectContent>
            {preview.headers
              .map((header, idx) => ({ header, idx }))
              .filter(({ idx }) => !emptyColumnSet.has(idx))
              .map(({ header, idx }) => {
                const inThisField = columns.includes(idx)
                const inOtherField = !inThisField && usedColumnSet.has(idx)
                return (
                  <SelectItem key={idx} value={String(idx)} disabled={inThisField || inOtherField}>
                    <span className="flex items-center">
                      {header || `컬럼 ${idx + 1}`}
                      {inOtherField && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          (이미 사용됨)
                        </span>
                      )}
                      {inThisField && (
                        <span className="ml-2 text-[10px] text-muted-foreground">(매핑됨)</span>
                      )}
                    </span>
                  </SelectItem>
                )
              })}
          </SelectContent>
        </Select>
        {columns.length > 1 && (
          <span className="ml-1 text-[11px] text-muted-foreground">공백으로 결합</span>
        )}
      </div>
    </div>
  )
}

// ---------- 오류 Dialog ----------

type ErrorDialogProps = {
  state: { open: boolean } & ImportResult
  onClose: () => void
  onReset: () => void
}

function ImportErrorDialog({ state, onClose, onReset }: ErrorDialogProps) {
  const { open, created, errorCount, errors } = state
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{created === 0 ? '가져오기 실패' : '가져오기 결과'}</DialogTitle>
          <DialogDescription>
            {created === 0
              ? `${errorCount}건 오류로 가져오기에 실패했습니다. 오류 내역을 확인하고 매핑을 수정하거나 다른 파일을 업로드해 주세요.`
              : `${created}건 등록, ${errorCount}건 오류가 발생했습니다.`}
          </DialogDescription>
        </DialogHeader>

        {errors.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">오류 상세</p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const tsv = errors
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
            <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-2">
              {errors.map((e, idx) => (
                <div key={idx} className="font-mono text-xs">
                  <span className="text-muted-foreground">행 {e.row}</span>
                  {e.recipientName && (
                    <span className="ml-2 text-muted-foreground">({e.recipientName})</span>
                  )}
                  <span className="ml-2 text-destructive">{e.message}</span>
                </div>
              ))}
              {errorCount > errors.length && (
                <div className="pt-1 text-xs text-muted-foreground">
                  ...외 {errorCount - errors.length}건 더
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onReset}>
            새 파일 업로드
          </Button>
          <Button onClick={onClose}>매핑 수정</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
