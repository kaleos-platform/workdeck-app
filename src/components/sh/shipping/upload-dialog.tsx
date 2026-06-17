'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  BookmarkPlus,
  Copy,
  Info,
  Save,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
  수취인명: 'recipientName',
  전화: 'phone',
  전화번호: 'phone',
  핸드폰: 'phone',
  핸드폰번호: 'phone',
  연락처: 'phone',
  수취인연락처1: 'phone',
  수취인연락처2: 'phone',
  주소: 'address',
  총주소: 'address',
  받는분주소: 'address',
  통합배송지: 'address',
  기본배송지: 'address',
  우편번호: 'postalCode',
  우편: 'postalCode',
  배송메시지: 'deliveryMessage',
  배송메세지: 'deliveryMessage',
  특기사항: 'deliveryMessage',
  특이사항: 'deliveryMessage',
  주문일: 'orderDate',
  주문일자: 'orderDate',
  주문일시: 'orderDate',
  결제일: 'orderDate',
  주문번호: 'orderNumber',
  결제금액: 'paymentAmount',
  '최종 상품별 총 주문금액': 'paymentAmount',
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
  orderDateFixed: string | null
  paymentIsOrderTotal?: boolean
}

// ---------- 프리셋 타입 ----------

type PresetMappingEntry = { headerName: string; field: string }

type PresetChannel = { id: string; name: string }

type Preset = {
  id: string
  name: string
  mapping: PresetMappingEntry[]
  channelId: string | null
  channel?: PresetChannel | null
  updatedAt: string
}

type Channel = { id: string; name: string }

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

// 헤더 목록과 프리셋 목록을 비교해 가장 적합한 프리셋을 찾는다
function findBestPreset(presets: Preset[], headers: string[]): Preset | null {
  const headerSet = new Set(headers.map((h) => h.trim()).filter(Boolean))
  let exact: Preset | null = null
  let best: { preset: Preset; matched: number } | null = null
  for (const p of presets) {
    const need = new Set(p.mapping.map((m) => m.headerName))
    let matched = 0
    for (const h of need) if (headerSet.has(h)) matched++
    if (matched === need.size && headerSet.size >= need.size && !exact) exact = p
    if (!best || matched > best.matched) best = { preset: p, matched }
  }
  if (exact) return exact
  if (best && best.matched / best.preset.mapping.length >= 0.7) return best.preset
  return null
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

// 어제 날짜를 로컬 타임존 기준 YYYY-MM-DD 로 반환
function yesterdayLocal(): string {
  const d = new Date(Date.now() - 86400000)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

async function saveDraft(
  batchId: string,
  state: {
    file: File | null
    preview: Preview
    mapping: Record<string, number[]>
    orderDateFixed: string | null
    paymentIsOrderTotal: boolean
  }
) {
  if (!batchId) return
  const key = draftKey(batchId)
  try {
    const base: Omit<Draft, 'fileBase64'> = {
      fileName: state.file?.name ?? '',
      preview: state.preview,
      mapping: state.mapping,
      orderDateFixed: state.orderDateFixed,
      paymentIsOrderTotal: state.paymentIsOrderTotal,
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
          orderDateFixed: state.orderDateFixed,
          paymentIsOrderTotal: state.paymentIsOrderTotal,
        })
      )
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        toast.message(
          '파일이 너무 커 매핑만 저장됩니다. 다이얼로그를 닫았다 다시 열면 파일 재업로드가 필요합니다.'
        )
      }
    } catch {
      // 아예 저장 불가 — 무시
    }
  }
}

// ---------- 메인 Dialog ----------

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  batchId: string
  /** 가져오기 완전 성공 시 호출 — 부모는 주문 목록 재fetch 처리 */
  onImported: (created: number) => void
}

export function UploadDialog({ open, onOpenChange, batchId, onImported }: Props) {
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

  // 주문일자 고정 날짜 모드 상태
  const [orderDateFixed, setOrderDateFixed] = useState<string | null>(null)

  // 결제금액이 "주문 총액"(행마다 반복)인지 — true면 동일 주문 그룹에서 행끼리 합산하지 않음
  const [paymentIsOrderTotal, setPaymentIsOrderTotal] = useState(false)

  // 프리셋 관련 상태
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetMismatch, setPresetMismatch] = useState<{
    presetName: string
    matched: number
    total: number
    missingHeaders: string[]
  } | null>(null)

  // 채널 관련
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  // 암호 보호된 xlsx 처리 — 비밀번호는 다이얼로그가 열려 있는 동안만 메모리에 보관.
  // preview / import 두 단계 모두 같은 password를 사용해야 하므로 state로 유지.
  const [filePassword, setFilePassword] = useState('')
  const [passwordPrompt, setPasswordPrompt] = useState<{
    file: File
    error?: string
  } | null>(null)
  const [passwordInput, setPasswordInput] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  const draftLoadedRef = useRef(false)
  // 자동 프리셋 적용이 이미 시도됐는지 추적 — 한 번만 실행되도록
  const autoPresetTriedRef = useRef(false)

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

  // 프리셋 상태 변경 코어 — toast 없이 상태만 바꿈
  function applyPresetState(preset: Preset) {
    if (!preview) return
    const result = applyPreset(preset.mapping, preview.headers)
    setMapping(result.mapping)
    setSelectedChannelId(preset.channelId ?? null)
    if (result.matched < result.total) {
      setPresetMismatch({
        presetName: preset.name,
        matched: result.matched,
        total: result.total,
        missingHeaders: result.missingHeaders,
      })
    } else {
      setPresetMismatch(null)
    }
    return result
  }

  // 프리셋 적용 (수동 — 토스트 포함)
  function handleApplyPreset(preset: Preset) {
    const result = applyPresetState(preset)
    if (!result) return
    if (result.matched < result.total) {
      // mismatch toast는 MappingView의 배너가 대신 표시
    } else {
      const chanSuffix = preset.channel?.name ? ` (판매채널: ${preset.channel.name})` : ''
      toast.success(`프리셋 "${preset.name}" 적용 완료${chanSuffix}`)
    }
  }

  // 프리셋 저장
  async function handleSavePreset(name: string, channelId: string | null) {
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
        body: JSON.stringify({ name, mapping: entries, channelId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '저장 실패')
      }
      toast.success(`프리셋 "${name}" 저장 완료`)
      setSelectedChannelId(channelId)
      await loadPresets()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '프리셋 저장 실패')
    }
  }

  // 프리셋 삭제
  async function handleDeletePreset(preset: Preset) {
    if (!confirm(`프리셋 "${preset.name}"을 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/sh/shipping/column-mapping-presets/${preset.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '삭제 실패')
      }
      toast.success(`프리셋 "${preset.name}" 삭제 완료`)
      await loadPresets()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '프리셋 삭제 실패')
    }
  }

  // 다이얼로그 열릴 때 초기 데이터 로드 + draft 복원
  useEffect(() => {
    if (!open || !batchId) return

    let cancelled = false
    draftLoadedRef.current = false
    autoPresetTriedRef.current = false

    void (async () => {
      try {
        const res = await fetch('/api/channels?isActive=true')
        const data = await res.json()
        if (!cancelled) {
          setChannels(
            ((data.channels ?? []) as Array<{ id: string; name: string }>).map((c) => ({
              id: c.id,
              name: c.name,
            }))
          )
        }
      } catch {
        // 조용히 실패
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
        setOrderDateFixed(draft.orderDateFixed ?? null)
        setPaymentIsOrderTotal(draft.paymentIsOrderTotal ?? false)
        if (draft.fileBase64) {
          setFile(dataUrlToFile(draft.fileBase64, draft.fileName))
          setFileMissing(false)
        } else {
          setFile(null)
          setFileMissing(true)
        }
      } else {
        // draft 없으면 초기 상태
        setFile(null)
        setPreview(null)
        setMapping({})
        setOrderDateFixed(null)
        setPaymentIsOrderTotal(false)
        setFileMissing(false)
      }
    } catch {
      // 손상된 draft — 초기화
      setFile(null)
      setPreview(null)
      setMapping({})
      setOrderDateFixed(null)
      setPaymentIsOrderTotal(false)
      setFileMissing(false)
    }
    draftLoadedRef.current = true

    return () => {
      cancelled = true
    }
  }, [open, batchId, loadPresets])

  // presets 로드 후 자동 프리셋 적용 재시도 —
  // 파일 업로드 시 presets가 아직 없었을 경우를 대비
  useEffect(() => {
    if (
      !preview ||
      presets.length === 0 ||
      autoPresetTriedRef.current ||
      Object.keys(mapping).length > 0
    )
      return
    autoPresetTriedRef.current = true
    const best = findBestPreset(presets, preview.headers)
    if (!best) return
    const result = applyPreset(best.mapping, preview.headers)
    setMapping(result.mapping)
    setSelectedChannelId(best.channelId ?? null)
    if (result.matched < result.total) {
      setPresetMismatch({
        presetName: best.name,
        matched: result.matched,
        total: result.total,
        missingHeaders: result.missingHeaders,
      })
    } else {
      setPresetMismatch(null)
    }
    toast.success(`프리셋 "${best.name}"이 자동 적용되었습니다`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, preview])

  // mapping / orderDateFixed / paymentIsOrderTotal 변경 시 draft 갱신 (debounce)
  useEffect(() => {
    if (!open || !batchId || !preview || !draftLoadedRef.current) return
    const t = setTimeout(() => {
      void saveDraft(batchId, { file, preview, mapping, orderDateFixed, paymentIsOrderTotal })
    }, 300)
    return () => clearTimeout(t)
  }, [open, batchId, file, preview, mapping, orderDateFixed, paymentIsOrderTotal])

  async function handleFileUpload(selectedFile: File, password = '') {
    setFile(selectedFile)
    setFileMissing(false)
    autoPresetTriedRef.current = false
    const formData = new FormData()
    formData.append('file', selectedFile)
    if (password) formData.append('password', password)
    try {
      const res = await fetch('/api/sh/shipping/import/preview', {
        method: 'POST',
        body: formData,
      })
      if (res.status === 422) {
        const body = await res.json().catch(() => ({}))
        if (body?.code === 'ENCRYPTED_FILE_PASSWORD_REQUIRED') {
          // 첫 진입 — 비밀번호 모달 표시
          setPasswordPrompt({ file: selectedFile })
          setPasswordInput('')
          setFilePassword('')
          return
        }
        if (body?.code === 'WRONG_PASSWORD') {
          // 재시도 — 같은 모달에 오류 표시
          setPasswordPrompt({ file: selectedFile, error: '비밀번호가 올바르지 않습니다' })
          setPasswordInput('')
          setFilePassword('')
          return
        }
        throw new Error(body?.error ?? '파일 미리보기 실패')
      }
      if (!res.ok) throw new Error('파일 미리보기 실패')
      const data: Preview = await res.json()
      setPreview(data)
      // 복호화 성공 — 이후 import 요청에도 같은 비밀번호 사용
      setFilePassword(password)

      // 로드된 presets가 있으면 자동 프리셋 적용 시도, 없으면 autoMap 폴백
      let newMapping: Record<string, number[]>
      if (presets.length > 0) {
        autoPresetTriedRef.current = true
        const best = findBestPreset(presets, data.headers)
        if (best) {
          const result = applyPreset(best.mapping, data.headers)
          newMapping = result.mapping
          setSelectedChannelId(best.channelId ?? null)
          if (result.matched < result.total) {
            setPresetMismatch({
              presetName: best.name,
              matched: result.matched,
              total: result.total,
              missingHeaders: result.missingHeaders,
            })
          } else {
            setPresetMismatch(null)
            toast.success(`프리셋 "${best.name}"이 자동 적용되었습니다`)
          }
        } else {
          newMapping = autoMap(data)
        }
      } else {
        newMapping = autoMap(data)
      }

      setMapping(newMapping)

      // 즉시 저장 (mapping effect debounce 안 탈 수 있으므로)
      await saveDraft(batchId, {
        file: selectedFile,
        preview: data,
        mapping: newMapping,
        orderDateFixed,
        paymentIsOrderTotal,
      })
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
    setOrderDateFixed(null)
    setPaymentIsOrderTotal(false)
    setFileMissing(false)
    setErrorDialog({ open: false, created: 0, errorCount: 0, errors: [] })
    setFilePassword('')
    setPasswordPrompt(null)
    setPasswordInput('')
    autoPresetTriedRef.current = false
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
    onOpenChange(false)
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
    if (!selectedChannelId) {
      toast.error('판매채널을 지정해 주세요')
      return
    }

    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('batchId', batchId)
      formData.append('channelId', selectedChannelId)
      if (filePassword) formData.append('password', filePassword)

      // 고정 날짜 모드면 orderDate를 { fixed: "YYYY-MM-DD" } 로 변환
      // 결제금액이 주문 총액이면 paymentIsOrderTotal 플래그를 함께 전달(행 합산 끄기)
      const finalMapping: Record<string, number[] | { fixed: string } | boolean> = {
        ...mapping,
        ...(orderDateFixed ? { orderDate: { fixed: orderDateFixed } } : {}),
        ...(paymentIsOrderTotal ? { paymentIsOrderTotal: true } : {}),
      }
      formData.append('columnMapping', JSON.stringify(finalMapping))

      const res = await fetch('/api/sh/shipping/import', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '가져오기 실패')

      if (data.errorCount === 0) {
        // 완전 성공 → 임시저장 삭제 후 부모에 알림 + 닫기
        try {
          sessionStorage.removeItem(draftKey(batchId))
        } catch {
          // 무시
        }
        toast.success(`${data.created}건 가져오기 완료`)
        onImported(data.created)
        onOpenChange(false)
        return
      }

      // 실패 또는 부분 성공 → 오류 Dialog 표시
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="!top-0 !left-0 flex h-screen max-h-screen w-screen max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
        >
          <DialogHeader className="shrink-0 border-b bg-background px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-1 h-8 shrink-0"
                  onClick={() => onOpenChange(false)}
                >
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  배송 등록
                </Button>
                <div className="h-5 w-px bg-border" />
                <DialogTitle className="truncate text-base font-semibold">
                  채널 파일 업로드
                </DialogTitle>
                {preview && (
                  <span className="truncate text-xs text-muted-foreground">
                    · 파일: {file?.name ?? '(재업로드 필요)'} · 총 {preview.totalRows}건
                  </span>
                )}
              </div>
              {hasDraft && (
                <div className="flex shrink-0 items-center gap-2">
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
            </div>
            <DialogDescription className="sr-only">
              Excel 또는 CSV 파일을 업로드해 컬럼을 매핑하고 주문을 가져옵니다.
            </DialogDescription>
          </DialogHeader>

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
                onDeletePreset={handleDeletePreset}
                presetMismatch={presetMismatch}
                onDismissMismatch={() => setPresetMismatch(null)}
                channels={channels}
                selectedChannelId={selectedChannelId}
                onChangeChannel={setSelectedChannelId}
                orderDateFixed={orderDateFixed}
                onOrderDateFixedChange={setOrderDateFixed}
                paymentIsOrderTotal={paymentIsOrderTotal}
                onPaymentIsOrderTotalChange={setPaymentIsOrderTotal}
              />
            )}
          </div>

          {preview && (
            <footer className="flex shrink-0 items-center justify-between border-t bg-background px-6 py-3">
              <span className="text-xs text-muted-foreground">
                매핑 완료 {mappedFieldCount} / {FIELDS.length}
              </span>
              <div className="flex items-center gap-3">
                {missingRequired && (
                  <span className="text-xs text-destructive">받는분·전화·주소를 매핑해 주세요</span>
                )}
                {!selectedChannelId && (
                  <span className="text-xs text-destructive">판매채널을 지정해 주세요</span>
                )}
                {fileMissing && (
                  <span className="text-xs text-destructive">파일을 다시 선택해 주세요</span>
                )}
                <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                  취소
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={importing || missingRequired || fileMissing || !selectedChannelId}
                >
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
        </DialogContent>
      </Dialog>

      <ImportErrorDialog
        state={errorDialog}
        onClose={() => setErrorDialog((prev) => ({ ...prev, open: false }))}
        onReset={() => {
          setErrorDialog((prev) => ({ ...prev, open: false }))
          clearAll()
        }}
      />

      <Dialog
        open={passwordPrompt !== null}
        onOpenChange={(v) => {
          if (!v) {
            setPasswordPrompt(null)
            setPasswordInput('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>비밀번호로 보호된 파일</DialogTitle>
            <DialogDescription>
              선택한 파일이 비밀번호로 보호되어 있습니다. 파일 열기 비밀번호를 입력해 주세요.
              <br />
              <span className="text-xs text-muted-foreground">
                비밀번호는 업로드 처리에만 사용되며 저장되지 않습니다.
              </span>
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!passwordPrompt || !passwordInput) return
              const target = passwordPrompt.file
              setPasswordPrompt(null)
              void handleFileUpload(target, passwordInput)
              setPasswordInput('')
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="xlsx-password">비밀번호</Label>
              <Input
                id="xlsx-password"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                autoFocus
                autoComplete="off"
              />
              {passwordPrompt?.error && (
                <p className="text-xs text-destructive">{passwordPrompt.error}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPasswordPrompt(null)
                  setPasswordInput('')
                }}
              >
                취소
              </Button>
              <Button type="submit" disabled={!passwordInput}>
                확인
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
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
  onSavePreset: (name: string, channelId: string | null) => Promise<void>
  onDeletePreset: (preset: Preset) => Promise<void>
  presetMismatch: {
    presetName: string
    matched: number
    total: number
    missingHeaders: string[]
  } | null
  onDismissMismatch: () => void
  channels: Channel[]
  selectedChannelId: string | null
  onChangeChannel: (channelId: string | null) => void
  orderDateFixed: string | null
  onOrderDateFixedChange: (v: string | null) => void
  paymentIsOrderTotal: boolean
  onPaymentIsOrderTotalChange: (v: boolean) => void
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
    onDeletePreset,
    presetMismatch,
    onDismissMismatch,
    channels,
    selectedChannelId,
    onChangeChannel,
    orderDateFixed,
    onOrderDateFixedChange,
    paymentIsOrderTotal,
    onPaymentIsOrderTotalChange,
  } = p

  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [dialogChannelId, setDialogChannelId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  async function handleSave() {
    if (!presetName.trim()) return
    setSaving(true)
    try {
      await onSavePreset(presetName.trim(), dialogChannelId)
      setSaveDialogOpen(false)
      setPresetName('')
    } finally {
      setSaving(false)
    }
  }

  const NO_CHANNEL = '__none__'
  const selectedChannelName = channels.find((c) => c.id === selectedChannelId)?.name ?? null

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

      {/* 프리셋 + 채널 영역 */}
      <section className="flex flex-wrap items-center gap-2">
        {presets.length > 0 && (
          <Select
            value=""
            onValueChange={(v) => {
              const preset = presets.find((pr) => pr.id === v)
              if (preset) onApplyPreset(preset)
            }}
          >
            <SelectTrigger className="h-8 w-auto min-w-[12rem] text-xs">
              <SelectValue placeholder="저장된 프리셋 적용..." />
            </SelectTrigger>
            <SelectContent>
              {presets.map((pr) => (
                <SelectItem key={pr.id} value={pr.id}>
                  <span>{pr.name}</span>
                  {pr.channel?.name ? (
                    <span className="ml-2 text-xs text-muted-foreground">· {pr.channel.name}</span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* 프리셋 관리 Popover — 삭제 */}
        {presets.length > 0 && (
          <Popover open={manageOpen} onOpenChange={setManageOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground">
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="start">
              <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">프리셋 관리</p>
              <div className="space-y-0.5">
                {presets.map((pr) => (
                  <div
                    key={pr.id}
                    className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{pr.name}</span>
                      {pr.channel?.name && (
                        <span className="text-[10px] text-muted-foreground">{pr.channel.name}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`${pr.name} 삭제`}
                      className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={async () => {
                        const wasLast = presets.length === 1
                        await onDeletePreset(pr)
                        if (wasLast) setManageOpen(false)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            setPresetName('')
            setDialogChannelId(selectedChannelId)
            setSaveDialogOpen(true)
          }}
        >
          <BookmarkPlus className="mr-1 h-3.5 w-3.5" />
          현재 매핑 저장
        </Button>

        {/* 판매채널 — 필수(*) 표기 */}
        <div className="ml-1 flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">
            판매채널 <span className="text-destructive">*</span>
          </Label>
          <Select
            value={selectedChannelId ?? NO_CHANNEL}
            onValueChange={(v) => onChangeChannel(v === NO_CHANNEL ? null : v)}
          >
            <SelectTrigger className="h-8 w-auto min-w-[11rem] text-xs">
              <SelectValue placeholder="지정 안 함" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CHANNEL}>지정 안 함</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedChannelName && (
            <Badge variant="secondary" className="text-[10px]">
              가져오기 후 자동 입력
            </Badge>
          )}
        </div>
      </section>

      {/* 프리셋 저장 Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>컬럼 매핑 프리셋 저장</DialogTitle>
            <DialogDescription>
              현재 매핑을 이름을 지정하여 저장합니다. 같은 이름이 있으면 덮어씁니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
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
            <div className="space-y-2">
              <Label htmlFor="preset-channel">판매채널 (선택)</Label>
              <Select
                value={dialogChannelId ?? NO_CHANNEL}
                onValueChange={(v) => setDialogChannelId(v === NO_CHANNEL ? null : v)}
              >
                <SelectTrigger id="preset-channel">
                  <SelectValue placeholder="판매채널 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHANNEL}>지정 안 함</SelectItem>
                  {channels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                이 프리셋을 적용하면 가져온 주문의 판매채널로 자동 지정됩니다.
              </p>
            </div>
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

      {/* 컬럼 매핑 */}
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
          {FIELDS.map((field) => {
            // 주문일자는 고정 날짜 모드 UI를 별도 렌더링
            if (field.value === 'orderDate') {
              return (
                <div key={field.value} className="bg-background">
                  <OrderDateRow
                    preview={preview}
                    columns={mapping['orderDate'] ?? []}
                    usedColumnSet={usedColumnSet}
                    emptyColumnSet={emptyColumnSet}
                    hoveredColumnIdx={hoveredColumnIdx}
                    setHoveredColumnIdx={setHoveredColumnIdx}
                    onAdd={(idx) => addColumn('orderDate', idx)}
                    onRemove={(idx) => removeColumn('orderDate', idx)}
                    orderDateFixed={orderDateFixed}
                    onOrderDateFixedChange={onOrderDateFixedChange}
                  />
                </div>
              )
            }
            return (
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
                  paymentIsOrderTotal={
                    field.value === 'paymentAmount' ? paymentIsOrderTotal : undefined
                  }
                  onPaymentIsOrderTotalChange={
                    field.value === 'paymentAmount' ? onPaymentIsOrderTotalChange : undefined
                  }
                />
              </div>
            )
          })}
        </div>
      </section>

      {/* 샘플 데이터 */}
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

// ---------- 주문일자 행 (고정 날짜 모드 포함) ----------

type OrderDateRowProps = {
  preview: Preview
  columns: number[]
  usedColumnSet: Set<number>
  emptyColumnSet: Set<number>
  hoveredColumnIdx: number | null
  setHoveredColumnIdx: (v: number | null) => void
  onAdd: (idx: number) => void
  onRemove: (idx: number) => void
  orderDateFixed: string | null
  onOrderDateFixedChange: (v: string | null) => void
}

function OrderDateRow({
  preview,
  columns,
  usedColumnSet,
  emptyColumnSet,
  hoveredColumnIdx,
  setHoveredColumnIdx,
  onAdd,
  onRemove,
  orderDateFixed,
  onOrderDateFixedChange,
}: OrderDateRowProps) {
  const isFixed = orderDateFixed !== null

  function handleModeChange(mode: 'column' | 'fixed') {
    if (mode === 'fixed') {
      onOrderDateFixedChange(yesterdayLocal())
    } else {
      onOrderDateFixedChange(null)
    }
  }

  return (
    <div className="flex items-start gap-3 px-3 py-2">
      <div className="w-28 shrink-0 pt-1.5 text-sm">
        <span>주문일자</span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {/* 모드 토글 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleModeChange('column')}
            className={cn(
              'rounded px-2 py-0.5 text-xs transition-colors',
              !isFixed
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            파일 컬럼
          </button>
          <span className="text-xs text-muted-foreground">/</span>
          <button
            type="button"
            onClick={() => handleModeChange('fixed')}
            className={cn(
              'rounded px-2 py-0.5 text-xs transition-colors',
              isFixed
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            고정 날짜
          </button>
        </div>

        {/* 모드별 입력 */}
        {isFixed ? (
          <Input
            type="date"
            value={orderDateFixed ?? ''}
            onChange={(e) => onOrderDateFixedChange(e.target.value || null)}
            className="h-7 w-40 text-xs"
          />
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
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
              <SelectTrigger className="h-7 w-auto min-w-[9rem] border-dashed text-xs">
                <SelectValue
                  placeholder={columns.length === 0 ? '+ 파일 컬럼 선택' : '+ 컬럼 추가'}
                />
              </SelectTrigger>
              <SelectContent>
                {preview.headers
                  .map((header, idx) => ({ header, idx }))
                  .filter(({ idx }) => !emptyColumnSet.has(idx))
                  .map(({ header, idx }) => {
                    const inThisField = columns.includes(idx)
                    const inOtherField = !inThisField && usedColumnSet.has(idx)
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
                            <span className="ml-2 text-[10px] text-muted-foreground">(매핑됨)</span>
                          )}
                        </span>
                      </SelectItem>
                    )
                  })}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
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
  /** paymentAmount 필드 전용 — "주문 총액(행 합산 안 함)" 토글 상태/변경 */
  paymentIsOrderTotal?: boolean
  onPaymentIsOrderTotalChange?: (v: boolean) => void
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
  paymentIsOrderTotal,
  onPaymentIsOrderTotalChange,
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
          <span className="ml-1 text-[11px] text-muted-foreground">
            {field.value === 'paymentAmount' ? '숫자 합계로 계산' : '공백으로 결합'}
          </span>
        )}
        {field.value === 'paymentAmount' && onPaymentIsOrderTotalChange && columns.length > 0 && (
          <label className="mt-1 flex w-full cursor-pointer items-start gap-2 text-[11px] text-muted-foreground">
            <Checkbox
              checked={!!paymentIsOrderTotal}
              onCheckedChange={(v) => onPaymentIsOrderTotalChange(v === true)}
              className="mt-0.5"
            />
            <span>
              주문 총 결제금액 (행마다 같은 금액이 반복되면 켜세요 — 동일 주문의 행끼리 합산하지
              않습니다)
            </span>
          </label>
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
