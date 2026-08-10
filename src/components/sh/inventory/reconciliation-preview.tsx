'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Link2, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { FloatingActionBar, floatingActionButtonClass } from '@/components/ui/floating-action-bar'
import {
  OptionPickerDialog,
  type PickedOptionWithQty,
} from '@/components/sh/products/listings/option-picker-dialog'
import { applyRangeSelection } from '@/lib/range-selection'
import { reconStatusBadge, type ReconStatus } from './recon-status-display'

type ParsedRow = {
  externalCode: string
  externalName?: string
  externalOptionName?: string
  quantity: number
}

type SuggestionOption = {
  optionId: string
  productName: string
  optionName: string
}

type MappingItem = {
  optionId: string
  quantity: number
  productName: string
  optionName: string
}

/** GET /locations/[id]/mappings 응답 — SKU 중복 확인용(필요한 필드만) */
type ExistingMapping = {
  id: string
  externalCode: string
  items: {
    optionId: string
    quantity: number
    option: { name: string; product: { name: string } }
  }[]
}

type MatchEntry =
  | {
      status: 'matched-diff'
      row: ParsedRow
      optionId: string
      productName: string
      optionName: string
      mapItemQuantity: number
      systemQuantity: number
      fileQuantity: number
      delta: number
      mappingId?: string
      mappingItems?: MappingItem[]
    }
  | {
      status: 'matched-equal'
      row: ParsedRow
      optionId: string
      productName: string
      optionName: string
      mapItemQuantity: number
      systemQuantity: number
      fileQuantity: number
      mappingId?: string
      mappingItems?: MappingItem[]
    }
  | {
      status: 'file-only'
      row: ParsedRow
      suggestions: SuggestionOption[]
    }
  | {
      status: 'system-only'
      optionId: string
      productName: string
      optionName: string
      systemQuantity: number
      /** 이 위치에 연결된 외부 SKU 매핑이 있는지. false면 자동 대조가 재고를 건드리지 않는다. */
      hasMapping?: boolean
    }

type Reconciliation = {
  id: string
  fileName: string
  snapshotDate: string
  status: ReconStatus
  totalItems: number
  matchedItems: number
  adjustedItems: number
  appliedOptionIds: string[]
  location: { id: string; name: string }
  matchResults: MatchEntry[]
}

type Props = {
  reconciliationId: string
  onClose: () => void
  onConfirmed: () => void
  // 미리보기를 닫지 않고 상위(왼쪽 목록)만 갱신해야 할 때 호출 (예: 부분 적용)
  onChanged?: () => void
}

type UnifiedEntry = {
  key: string
  status: string
  productName: string
  optionName: string
  externalOptionName: string
  isManualMatched?: boolean
  systemQty: number | null
  fileQty: number | null
  delta: number | null
  optionId?: string
  externalCode?: string
  suggestions?: SuggestionOption[]
  row?: ParsedRow
  mappingId?: string
  mappingItems?: MappingItem[]
  mapItemQuantity?: number
  /** system-only 인데 외부 SKU 매핑이 없음 — 자동 대조가 건드리지 못하는 잔여 */
  needsMapping?: boolean
}

const STATUS_FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'matched-diff', label: '차이있음' },
  { value: 'matched-equal', label: '일치' },
  { value: 'file-only', label: '미매칭' },
  { value: 'system-only', label: '파일 누락' },
] as const

function entryStatusBadge(status: string) {
  switch (status) {
    case 'matched-diff':
      return <Badge className="border-amber-200 bg-amber-100 text-amber-700">차이있음</Badge>
    case 'matched-equal':
      return <Badge className="border-green-200 bg-green-100 text-green-700">일치</Badge>
    case 'file-only':
      return <Badge className="border-red-200 bg-red-100 text-red-700">미매칭</Badge>
    case 'system-only':
      return <Badge className="border-gray-200 bg-gray-100 text-gray-600">파일 누락</Badge>
    default:
      return null
  }
}

function isSelectable(entry: UnifiedEntry, manualMap: Record<string, PickedOptionWithQty[]>) {
  if (entry.status === 'matched-diff') return true
  if (entry.status === 'file-only' && entry.externalCode) {
    return (manualMap[entry.externalCode]?.length ?? 0) > 0
  }
  return false
}

function manualItemsToLabel(items: PickedOptionWithQty[]): string {
  if (items.length === 0) return '-'
  const first = `${items[0].productName} / ${items[0].optionName}${items[0].quantity > 1 ? ` × ${items[0].quantity}` : ''}`
  if (items.length === 1) return first
  return `${first} 외 ${items.length - 1}개`
}

function manualItemsToProductLabel(items: PickedOptionWithQty[]): string {
  if (items.length === 0) return '-'
  if (items.length === 1) return items[0].productName
  return `${items[0].productName} 외 ${items.length - 1}개`
}

function manualItemsToOptionLabel(items: PickedOptionWithQty[]): string {
  if (items.length === 0) return '-'
  const first = `${items[0].optionName}${items[0].quantity > 1 ? ` × ${items[0].quantity}` : ''}`
  if (items.length === 1) return first
  return `${first} 외 ${items.length - 1}개`
}

export function ReconciliationPreview({
  reconciliationId,
  onClose,
  onConfirmed,
  onChanged,
}: Props) {
  const [recon, setRecon] = useState<Reconciliation | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'matched-diff' | 'matched-equal' | 'file-only' | 'system-only'
  >('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // externalCode → PickedOptionWithQty[] (다중 옵션+수량)
  const [manualMap, setManualMap] = useState<Record<string, PickedOptionWithQty[]>>({})
  // 수동 매칭한 옵션의 이 위치 현재 재고 (optionId → quantity). 매칭 즉시 조회해 현재재고·차이 표시.
  const [manualStock, setManualStock] = useState<Record<string, number>>({})

  const lastClickedIndexRef = useRef<number | null>(null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerExternalCode, setPickerExternalCode] = useState<string | null>(null)
  const [pickerContext, setPickerContext] = useState('')
  const [pickerQuery, setPickerQuery] = useState('')

  // matched-* 행 매칭 수정용 picker 상태
  const [editMatcherOpen, setEditMatcherOpen] = useState(false)
  const [editMatcherEntry, setEditMatcherEntry] = useState<UnifiedEntry | null>(null)

  // system-only(매핑 없음) 행 → 쿠팡 SKU 연결 다이얼로그 상태
  const [skuLinkEntry, setSkuLinkEntry] = useState<UnifiedEntry | null>(null)
  const [skuLinkCode, setSkuLinkCode] = useState('')
  const [skuLinkSaving, setSkuLinkSaving] = useState(false)
  // 이 위치의 기존 매핑 — 입력한 SKU 가 이미 쓰이는지 확인해 덮어쓰기를 막는다.
  const [existingMappings, setExistingMappings] = useState<ExistingMapping[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/inventory/reconciliation/${reconciliationId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '조회 실패')
      const r = data.reconciliation as Reconciliation
      setRecon(r)
      const appliedSet = new Set(r.appliedOptionIds ?? [])
      const diffKeys = (r.matchResults ?? [])
        .filter(
          (e): e is Extract<MatchEntry, { status: 'matched-diff' }> => e.status === 'matched-diff'
        )
        .filter((e) => !appliedSet.has(e.optionId))
        .map((e) => `diff-${e.optionId}`)
      setSelected(new Set(diffKeys))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [reconciliationId])

  useEffect(() => {
    load()
  }, [load])

  const entries = useMemo(() => recon?.matchResults ?? [], [recon])
  const appliedOptionIds = useMemo(() => recon?.appliedOptionIds ?? [], [recon])

  const diffEntries = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<MatchEntry, { status: 'matched-diff' }> => e.status === 'matched-diff'
      ),
    [entries]
  )
  const equalEntries = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<MatchEntry, { status: 'matched-equal' }> => e.status === 'matched-equal'
      ),
    [entries]
  )
  const fileOnlyEntries = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<MatchEntry, { status: 'file-only' }> => e.status === 'file-only'
      ),
    [entries]
  )
  const systemOnlyEntries = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<MatchEntry, { status: 'system-only' }> => e.status === 'system-only'
      ),
    [entries]
  )

  // 입력한 SKU 가 이미 이 위치에 매핑돼 있는지 — 있으면 교체가 아니라 추가로 처리한다
  const skuLinkConflict = useMemo(
    () => existingMappings.find((m) => m.externalCode === skuLinkCode.trim()) ?? null,
    [existingMappings, skuLinkCode]
  )

  // 매핑이 없어 자동 대조가 손대지 못한 system-only 건수 — 사용자 안내 대상
  const needsMappingCount = useMemo(
    () => systemOnlyEntries.filter((e) => e.hasMapping === false).length,
    [systemOnlyEntries]
  )

  const counts = {
    all: entries.length,
    'matched-diff': diffEntries.length,
    'matched-equal': equalEntries.length,
    'file-only': fileOnlyEntries.length,
    'system-only': systemOnlyEntries.length,
  }

  const unifiedEntries = useMemo<UnifiedEntry[]>(() => {
    const result: UnifiedEntry[] = []

    for (const e of diffEntries) {
      result.push({
        key: `diff-${e.optionId}`,
        status: 'matched-diff',
        productName: e.productName,
        optionName: e.optionName,
        externalOptionName: e.row.externalOptionName ?? '-',
        systemQty: e.systemQuantity,
        fileQty: e.fileQuantity,
        delta: e.delta,
        optionId: e.optionId,
        row: e.row,
        mappingId: e.mappingId,
        mappingItems: e.mappingItems,
        mapItemQuantity: e.mapItemQuantity,
      })
    }

    for (const e of equalEntries) {
      result.push({
        key: `equal-${e.optionId}`,
        status: 'matched-equal',
        productName: e.productName,
        optionName: e.optionName,
        externalOptionName: e.row.externalOptionName ?? '-',
        systemQty: e.systemQuantity,
        fileQty: e.fileQuantity,
        delta: 0,
        optionId: e.optionId,
        row: e.row,
        mappingId: e.mappingId,
        mappingItems: e.mappingItems,
        mapItemQuantity: e.mapItemQuantity,
      })
    }

    for (const e of fileOnlyEntries) {
      const code = e.row.externalCode
      const items = manualMap[code]
      const isMapped = !!(items && items.length > 0)

      // 수동 매칭 시 현재 재고·차이 파생: 현재재고=Σ 옵션별 위치재고, 목표=Σ 파일수량×세트수량, 차이=목표−현재
      let sysQty: number | null = null
      let delta: number | null = null
      if (isMapped) {
        const hasStock = items!.every((i) => manualStock[i.optionId] !== undefined)
        if (hasStock) {
          const current = items!.reduce((s, i) => s + (manualStock[i.optionId] ?? 0), 0)
          const target = items!.reduce((s, i) => s + e.row.quantity * i.quantity, 0)
          sysQty = current
          delta = target - current
        }
      }

      result.push({
        key: `file-${code}`,
        status: 'file-only',
        productName: isMapped
          ? manualItemsToProductLabel(items!)
          : (e.row.externalName ?? e.row.externalCode),
        optionName: isMapped ? manualItemsToOptionLabel(items!) : '-',
        externalOptionName: e.row.externalOptionName ?? '-',
        isManualMatched: isMapped,
        systemQty: sysQty,
        fileQty: e.row.quantity,
        delta,
        externalCode: code,
        suggestions: e.suggestions,
        row: e.row,
      })
    }

    for (const e of systemOnlyEntries) {
      result.push({
        key: `sys-${e.optionId}`,
        status: 'system-only',
        productName: e.productName,
        optionName: e.optionName,
        externalOptionName: '-',
        systemQty: e.systemQuantity,
        fileQty: null,
        delta: null,
        optionId: e.optionId,
        needsMapping: e.hasMapping === false,
      })
    }

    return result
  }, [diffEntries, equalEntries, fileOnlyEntries, systemOnlyEntries, manualMap, manualStock])

  const filteredEntries = useMemo(
    () =>
      statusFilter === 'all'
        ? unifiedEntries
        : unifiedEntries.filter((e) => {
            if (statusFilter === 'file-only') {
              return e.status === 'file-only'
            }
            return e.status === statusFilter
          }),
    [unifiedEntries, statusFilter]
  )

  const isApplied = useCallback(
    (entry: UnifiedEntry): boolean => {
      if (entry.optionId && appliedOptionIds.includes(entry.optionId)) return true
      if (entry.externalCode) {
        const items = manualMap[entry.externalCode]
        if (items && items.length > 0) {
          return items.every((i) => appliedOptionIds.includes(i.optionId))
        }
      }
      return false
    },
    [appliedOptionIds, manualMap]
  )

  const selectableKeys = useMemo(
    () =>
      filteredEntries
        .filter((e) => isSelectable(e, manualMap))
        .filter((e) => !isApplied(e))
        .map((e) => e.key),
    [filteredEntries, isApplied, manualMap]
  )

  const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => selected.has(k))

  function toggleSelectAll() {
    if (allSelected) {
      setSelected((s) => {
        const next = new Set(s)
        selectableKeys.forEach((k) => next.delete(k))
        return next
      })
    } else {
      setSelected((s) => {
        const next = new Set(s)
        selectableKeys.forEach((k) => next.add(k))
        return next
      })
    }
  }

  function toggleSelect(key: string, index: number, shiftKey: boolean) {
    setSelected((prev) =>
      applyRangeSelection(prev, selectableKeys, key, index, shiftKey, lastClickedIndexRef.current)
    )
    lastClickedIndexRef.current = index
  }

  function openPicker(entry: UnifiedEntry) {
    if (!entry.externalCode) return
    setPickerExternalCode(entry.externalCode)
    const name = entry.row?.externalName ?? entry.externalCode
    const optionName = entry.row?.externalOptionName
    setPickerContext(optionName ? `${name} / ${optionName}` : name)
    setPickerQuery(name)
    setPickerOpen(true)
  }

  function handlePickedMulti(items: PickedOptionWithQty[]) {
    if (!pickerExternalCode) return
    const code = pickerExternalCode
    setManualMap((m) => ({ ...m, [code]: items }))
    setSelected((s) => {
      const next = new Set(s)
      next.add(`file-${code}`)
      return next
    })
    setPickerOpen(false)
    const label = manualItemsToLabel(items)
    toast.success(`${label} 매칭됨`)
    // 매칭 즉시 현재 재고 조회 → 현재재고·차이 표시(적용 전 검토용)
    void fetchManualStock(items.map((i) => i.optionId))
  }

  async function fetchManualStock(optionIds: string[]) {
    if (!recon || optionIds.length === 0) return
    try {
      const res = await fetch(
        `/api/sh/inventory/locations/${recon.location.id}/stock?optionIds=${optionIds.join(',')}`
      )
      if (!res.ok) return
      const data: { stocks?: { optionId: string; quantity: number }[] } = await res.json()
      setManualStock((prev) => {
        const next = { ...prev }
        for (const id of optionIds) next[id] = 0 // 재고 행 없는 옵션=0
        for (const s of data.stocks ?? []) next[s.optionId] = s.quantity
        return next
      })
    } catch {
      // 조회 실패는 무시(표시만 미보강)
    }
  }

  function openEditMatcher(entry: UnifiedEntry) {
    setEditMatcherEntry(entry)
    setEditMatcherOpen(true)
  }

  async function openSkuLink(entry: UnifiedEntry) {
    setSkuLinkEntry(entry)
    setSkuLinkCode('')
    setExistingMappings([])
    if (!recon) return
    try {
      const res = await fetch(`/api/sh/inventory/locations/${recon.location.id}/mappings`)
      const data = await res.json()
      if (res.ok) setExistingMappings((data.mappings ?? []) as ExistingMapping[])
    } catch {
      // 조회 실패해도 입력은 가능 — 저장 직전 중복 확인이 없을 뿐이다(아래에서 재확인).
    }
  }

  // system-only(매핑 없음) 행에 외부 SKU 를 연결한다.
  // 연결되면 다음 회차 자동 대조부터 이 옵션이 스냅샷과 대조되고, 스냅샷에 없으면 0 처리된다.
  async function handleSkuLinkSave() {
    if (!skuLinkEntry?.optionId || !recon) return
    const externalCode = skuLinkCode.trim()
    if (!externalCode) {
      toast.error('쿠팡 SKU 번호를 입력해 주세요')
      return
    }

    setSkuLinkSaving(true)
    try {
      // 이미 이 SKU 에 매핑이 있으면 PATCH 로 items 를 "추가"한다.
      // POST 는 items 를 통째로 교체(deleteMany+createMany)하므로 세트 매핑의 나머지 구성품이
      // 조용히 사라진다 — 그 옵션들이 대조에서 빠지고 매일 자동 조정이 어긋난다.
      const conflict = existingMappings.find((m) => m.externalCode === externalCode)

      let res: Response
      if (conflict) {
        if (conflict.items.some((i) => i.optionId === skuLinkEntry.optionId)) {
          toast.info('이미 이 SKU 에 연결된 상품입니다')
          setSkuLinkEntry(null)
          await load()
          return
        }
        res = await fetch(
          `/api/sh/inventory/locations/${recon.location.id}/mappings?mappingId=${conflict.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [
                ...conflict.items.map((i) => ({ optionId: i.optionId, quantity: i.quantity })),
                { optionId: skuLinkEntry.optionId, quantity: 1 },
              ],
            }),
          }
        )
      } else {
        res = await fetch(`/api/sh/inventory/locations/${recon.location.id}/mappings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            externalCode,
            externalName: skuLinkEntry.productName,
            externalOptionName: skuLinkEntry.optionName,
            items: [{ optionId: skuLinkEntry.optionId, quantity: 1 }],
          }),
        })
      }

      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'SKU 연결 실패')
      toast.success(
        conflict
          ? `SKU ${externalCode} 연결에 ${skuLinkEntry.productName} 추가됨`
          : `${skuLinkEntry.productName} → SKU ${externalCode} 연결됨`
      )
      setSkuLinkEntry(null)
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'SKU 연결 실패')
    } finally {
      setSkuLinkSaving(false)
    }
  }

  // mappingItems → PickedOptionWithQty[] 변환 (sku 등 불필요 필드는 null/0)
  function mappingItemsToPickedWithQty(items: MappingItem[]): PickedOptionWithQty[] {
    return items.map((i) => ({
      optionId: i.optionId,
      optionName: i.optionName,
      productId: '',
      productName: i.productName,
      sku: null,
      brandName: null,
      retailPrice: null,
      totalStock: 0,
      quantity: i.quantity,
    }))
  }

  async function handleEditMatcherPickMulti(items: PickedOptionWithQty[]) {
    if (!editMatcherEntry || !recon) return
    const entry = editMatcherEntry
    setEditMatcherOpen(false)
    setEditMatcherEntry(null)

    if (!entry.mappingId) {
      toast.error('이 행에는 수정 가능한 매핑이 없습니다')
      return
    }

    try {
      const res = await fetch(
        `/api/sh/inventory/locations/${recon.location.id}/mappings?mappingId=${entry.mappingId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: items.map((i) => ({ optionId: i.optionId, quantity: i.quantity })),
          }),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '매핑 수정 실패')
      toast.success(`${manualItemsToLabel(items)} 으로 매칭 변경됨`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '매핑 수정 실패')
    }
  }

  function removeMapping(externalCode: string) {
    setManualMap((m) => {
      const next = { ...m }
      delete next[externalCode]
      return next
    })
    setSelected((s) => {
      const next = new Set(s)
      next.delete(`file-${externalCode}`)
      return next
    })
  }

  // 재고 대조에서는 옵션 중복 항상 허용 — 한 옵션이 여러 외부코드(채널 상품 묶음)에 등장 가능.
  // 같은 외부코드 내 중복은 OptionPickerDialog의 multi-with-qty 토글이 자연스럽게 막음.
  const excludeOptionIds: string[] = []

  async function handleConfirm() {
    if (!recon) return
    setSubmitting(true)
    try {
      const manualMappings = Object.entries(manualMap)
        .filter(([, items]) => items.length > 0)
        .map(([externalCode, items]) => ({
          externalCode,
          items: items.map((i) => ({ optionId: i.optionId, quantity: i.quantity })),
        }))

      const selectedOptionIds: string[] = []
      for (const key of selected) {
        if (key.startsWith('diff-')) {
          selectedOptionIds.push(key.slice(5))
        } else if (key.startsWith('file-')) {
          const items = manualMap[key.slice(5)]
          if (items) {
            for (const i of items) selectedOptionIds.push(i.optionId)
          }
        }
      }

      const res = await fetch(`/api/sh/inventory/reconciliation/${recon.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          selectedOptionIds,
          manualMappings,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '적용 실패')
      toast.success(`${data.adjustedCount}건 조정 완료`)
      await load()
      // 상태·조정 건수가 바뀌었으므로 왼쪽 목록도 갱신 (미리보기는 유지)
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '적용 실패')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleFinalize() {
    if (!recon) return
    if (!confirm('확정하면 더 이상 수정할 수 없습니다. 진행할까요?')) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/sh/inventory/reconciliation/${recon.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finalize' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '확정 실패')
      toast.success('확정되었습니다')
      onConfirmed()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '확정 실패')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel() {
    if (!recon) return
    if (!confirm('이 대조를 취소하시겠습니까?')) return
    try {
      const res = await fetch(`/api/sh/inventory/reconciliation/${recon.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '취소 실패')
      toast.success('취소되었습니다')
      onConfirmed()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '취소 실패')
    }
  }

  if (loading || !recon) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const canEdit = ['PENDING', 'PARTIAL'].includes(recon.status)
  const canFinalize = recon.status === 'APPLIED'
  const appliedCount = appliedOptionIds.length

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">{recon.fileName}</h2>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {recon.location.name} · 기준일{' '}
              {new Date(recon.snapshotDate).toISOString().slice(0, 10)}
            </span>
            {reconStatusBadge(recon.status)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            총 {recon.totalItems}건 · 자동매칭 {recon.matchedItems}건 · 조정 {recon.adjustedItems}건
            {appliedCount > 0 && ` · 적용 ${appliedCount}건`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canFinalize && (
            <Button size="sm" onClick={handleFinalize} disabled={submitting}>
              {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              확정
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={submitting}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              대조 취소
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>

      {needsMappingCount > 0 && (
        <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-sm">
          <p className="font-medium text-orange-900">
            쿠팡 SKU 연결이 필요한 상품 {needsMappingCount}건
          </p>
          <p className="mt-1 text-xs leading-relaxed text-orange-800">
            쿠팡 재고 데이터에는 없는데 이 위치에 재고가 남아 있는 상품입니다. 연결된 SKU 가 없어
            실제 소진인지 아직 연동되지 않은 상품인지 구분할 수 없어, 자동 대조가 재고를 그대로
            두었습니다. <strong>&apos;파일 누락&apos;</strong> 필터에서 각 행의{' '}
            <strong>&apos;쿠팡 SKU 연결&apos;</strong> 버튼으로 SKU 를 연결하면 다음 수집부터 자동
            반영됩니다.
          </p>
        </div>
      )}

      <div className="flex gap-1 rounded-lg border bg-muted p-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === f.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {f.label}
            <span className="ml-1.5 text-xs opacity-70">{counts[f.value]}</span>
          </button>
        ))}
      </div>

      {filteredEntries.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          해당 상태의 항목이 없습니다
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  {canEdit && selectableKeys.length > 0 && (
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="전체 선택"
                    />
                  )}
                </TableHead>
                <TableHead className="w-20">상태</TableHead>
                <TableHead className="min-w-[8rem]">상품명</TableHead>
                <TableHead className="w-28">파일 옵션명</TableHead>
                <TableHead className="min-w-[9rem]">매칭 상품 옵션</TableHead>
                <TableHead className="w-14 text-right">현재 재고</TableHead>
                <TableHead className="w-12 text-right">파일</TableHead>
                <TableHead className="w-12 text-right">차이</TableHead>
                <TableHead className="w-20 whitespace-nowrap">동작</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((entry, index) => {
                const selectable = isSelectable(entry, manualMap)
                const applied = isApplied(entry)
                const selectKey = entry.key
                const isMapped =
                  entry.externalCode !== undefined &&
                  (manualMap[entry.externalCode]?.length ?? 0) > 0

                return (
                  <TableRow key={entry.key} className={applied ? 'bg-green-50/30' : undefined}>
                    <TableCell>
                      {canEdit && selectable && (
                        <Checkbox
                          checked={selected.has(selectKey)}
                          disabled={applied}
                          onClick={
                            applied
                              ? undefined
                              : (e) => {
                                  toggleSelect(selectKey, index, e.shiftKey)
                                }
                          }
                          aria-label="행 선택"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {applied ? (
                        <Badge className="border-green-200 bg-green-100 text-green-700">
                          적용됨
                        </Badge>
                      ) : entry.status === 'file-only' && entry.isManualMatched ? (
                        <Badge className="border-blue-200 bg-blue-100 text-blue-700">매칭됨</Badge>
                      ) : entry.needsMapping ? (
                        <Badge className="border-orange-200 bg-orange-100 text-orange-700">
                          매핑 필요
                        </Badge>
                      ) : (
                        entryStatusBadge(entry.status)
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{entry.productName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.externalOptionName}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {entry.optionName}
                          {/* matched-* 행: 수량 비율이 1 초과인 경우 표시 */}
                          {(entry.status === 'matched-equal' || entry.status === 'matched-diff') &&
                            entry.mapItemQuantity !== undefined &&
                            entry.mapItemQuantity > 1 && (
                              <span className="ml-1 text-xs text-muted-foreground/70">
                                × {entry.mapItemQuantity}
                              </span>
                            )}
                        </span>
                        {canEdit && isMapped && entry.externalCode && (
                          <div className="flex shrink-0 items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                              onClick={() => openPicker(entry)}
                            >
                              수정
                            </Button>
                            <span className="text-muted-foreground/40">·</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-destructive"
                              onClick={() => removeMapping(entry.externalCode!)}
                            >
                              취소
                            </Button>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.systemQty !== null ? entry.systemQty : '-'}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {entry.fileQty !== null ? entry.fileQty : '-'}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono ${
                        entry.delta !== null
                          ? entry.delta > 0
                            ? 'text-emerald-600'
                            : entry.delta < 0
                              ? 'text-red-600'
                              : ''
                          : ''
                      }`}
                    >
                      {entry.delta !== null ? `${entry.delta > 0 ? '+' : ''}${entry.delta}` : '-'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {canEdit &&
                        (entry.status === 'matched-equal' || entry.status === 'matched-diff') &&
                        entry.mappingId && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => openEditMatcher(entry)}
                          >
                            매칭 수정
                          </Button>
                        )}
                      {canEdit && entry.status === 'file-only' && entry.externalCode && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => openPicker(entry)}
                        >
                          <Search className="mr-1 h-3 w-3" />
                          상품 선택
                        </Button>
                      )}
                      {canEdit && entry.needsMapping && entry.optionId && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => openSkuLink(entry)}
                        >
                          <Link2 className="mr-1 h-3 w-3" />
                          쿠팡 SKU 연결
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {canEdit && (
        <FloatingActionBar
          open={selected.size > 0}
          onClear={() => setSelected(new Set())}
          actions={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={floatingActionButtonClass}
              onClick={handleConfirm}
              disabled={submitting}
            >
              {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              선택 적용
            </Button>
          }
        >
          <span className="text-sm font-semibold">{selected.size}건 선택</span>
        </FloatingActionBar>
      )}

      {/* file-only 행 수동 매칭 picker */}
      <OptionPickerDialog
        open={pickerOpen}
        onOpenChange={(v) => {
          if (!v) setPickerOpen(false)
        }}
        mode="multi-with-qty"
        onPickMulti={handlePickedMulti}
        initialQuery={pickerQuery}
        searchOfficialName
        excludeOptionIds={excludeOptionIds}
        contextLabel="매칭 대상 (파일)"
        contextValue={pickerContext}
        initialItems={
          pickerExternalCode && manualMap[pickerExternalCode]
            ? manualMap[pickerExternalCode]
            : undefined
        }
      />

      {/* matched-* 행 매칭 수정용 picker */}
      <OptionPickerDialog
        open={editMatcherOpen}
        onOpenChange={(v) => {
          if (!v) {
            setEditMatcherOpen(false)
            setEditMatcherEntry(null)
          }
        }}
        mode="multi-with-qty"
        onPickMulti={handleEditMatcherPickMulti}
        excludeOptionIds={excludeOptionIds}
        contextLabel="현재 매칭"
        contextValue={
          editMatcherEntry ? `${editMatcherEntry.productName} / ${editMatcherEntry.optionName}` : ''
        }
        initialItems={
          editMatcherEntry?.mappingItems
            ? mappingItemsToPickedWithQty(editMatcherEntry.mappingItems)
            : undefined
        }
      />

      {/* system-only(매핑 없음) 행 → 쿠팡 SKU 연결 */}
      <Dialog
        open={!!skuLinkEntry}
        onOpenChange={(v) => {
          if (!v && !skuLinkSaving) setSkuLinkEntry(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>쿠팡 SKU 연결</DialogTitle>
            <DialogDescription>
              이 상품의 쿠팡 SKU 번호를 연결하면 다음 수집부터 자동 대조 대상이 됩니다. 쿠팡 SKU
              번호는 Wing 재고현황 엑셀의 &apos;SKU ID&apos; 열에서 확인할 수 있습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              <p className="font-medium">{skuLinkEntry?.productName}</p>
              <p className="text-xs text-muted-foreground">
                {skuLinkEntry?.optionName} · 현재 재고 {skuLinkEntry?.systemQty ?? 0}
              </p>
            </div>
            <Input
              value={skuLinkCode}
              onChange={(e) => setSkuLinkCode(e.target.value)}
              placeholder="쿠팡 SKU 번호 (예: 1234567890)"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSkuLinkSave()
              }}
              autoFocus
            />
            {skuLinkConflict ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-medium">이 SKU 는 이미 연결돼 있습니다</p>
                <p className="mt-0.5">
                  {skuLinkConflict.items
                    .map((i) => `${i.option.product.name} / ${i.option.name}`)
                    .join(', ')}
                </p>
                <p className="mt-1">
                  기존 연결을 유지한 채 이 상품을 <strong>추가</strong>합니다 (세트 구성품인 경우).
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                쿠팡에 등록되지 않은 상품이라면 연결하지 말고, 재고 이동으로 다른 위치로 옮겨
                주세요.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSkuLinkEntry(null)}
              disabled={skuLinkSaving}
            >
              취소
            </Button>
            <Button onClick={handleSkuLinkSave} disabled={skuLinkSaving || !skuLinkCode.trim()}>
              {skuLinkSaving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {skuLinkConflict ? '기존 연결에 추가' : '연결'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
