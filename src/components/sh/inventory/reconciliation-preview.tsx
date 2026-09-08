'use client'

// 재고 대조 상세 — 파일/데이터 연동 기준 워킹셋.
//
// 테이블에는 파일에서 온 행만 싣는다(matched-*, file-only). 시스템에만 있는 옵션은
// [재고 데이터 없는 상품] 다이얼로그가 담당한다 — 방향이 정반대라 같은 표에 섞으면
// 어느 쪽이 원본인지 알 수 없다.
//
// 재고 반영은 [확정] 하나로 끝난다: 차이 전량을 반영하고 CONFIRMED 로 잠근다.
// (부분 적용 + PARTIAL/APPLIED 상태 머신은 자동 대조 cron 전용)
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Loader2,
  PackageSearch,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  OptionPickerDialog,
  type PickedOptionWithQty,
} from '@/components/sh/products/listings/option-picker-dialog'
import { isSyntheticExternalCode } from '@/lib/inv/reconciliation-external-code'
import { reconStatusBadge, type ReconStatus } from './recon-status-display'
import { ReconciliationUnmatchedOptionsDialog } from './reconciliation-unmatched-options-dialog'

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
      /** 대조 당시엔 일치했으나 이후 재고가 변동돼 차이가 생긴 행 */
      driftedSinceMatch?: boolean
      /** 서버 합산 파생 — 같은 내부 옵션을 가리키는 형제 행 묶음 (aggregateMatchedByOption) */
      groupKey?: string
      groupFileQuantity?: number
      isGroupPrimary?: boolean
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
      groupKey?: string
      groupFileQuantity?: number
      isGroupPrimary?: boolean
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
  confirmedAt?: string | null
  appliedOptionIds: string[]
  location: { id: string; name: string }
  matchResults: MatchEntry[]
}

type Props = {
  reconciliationId: string
  onClose: () => void
  onConfirmed: () => void
  // 미리보기를 닫지 않고 상위(왼쪽 목록)만 갱신해야 할 때 호출
  onChanged?: () => void
}

/**
 * 병합 행을 구성하는 파일 쪽 멤버(외부 SKU 1개).
 *
 * 축이 둘이라 혼동하기 쉽다:
 *  - 축 A('함께 매칭'): 외부코드 1 → 옵션 N. 행이 optionId 로 쪼개진다. mappingItems 가 그것.
 *  - 축 B(이 members): 외부코드 N → 옵션 1. 여러 파일 행이 한 옵션을 가리켜 행을 합친다.
 * mappingId 는 외부코드 단위이므로 [매칭 수정]은 반드시 멤버별로 열어야 한다.
 */
type MatchedMember = {
  fileCode: string
  fileProductName: string
  fileOptionName: string
  fileRowQty: number
  mapItemQuantity: number
  /** 이 멤버의 기여분 = fileRowQty × mapItemQuantity */
  targetQty: number
  mappingId?: string
  mappingItems?: MappingItem[]
  row: ParsedRow
}

type UnifiedEntry = {
  key: string
  status: 'matched-diff' | 'matched-equal' | 'file-only'
  /** 파일 기준 값 */
  fileCode: string
  fileProductName: string
  fileOptionName: string
  fileRowQty: number
  /** 시스템 기준 값 — 미매칭이면 null */
  sysProductName: string | null
  sysOptionName: string | null
  systemQty: number | null
  /** 목표 수량(파일 수량 × 세트 수량) */
  targetQty: number | null
  delta: number | null
  isManualMatched?: boolean
  /** 수동 매칭 행의 선택 옵션 전체 — 표에서 접지 않고 모두 보여준다. */
  sysItems?: PickedOptionWithQty[]
  optionId?: string
  suggestions?: SuggestionOption[]
  row?: ParsedRow
  mappingId?: string
  mappingItems?: MappingItem[]
  mapItemQuantity?: number
  /** 대조 당시엔 일치했으나 이후 재고가 변동된 행 — 확정 범위가 늘어나는 부분 */
  driftedSinceMatch?: boolean
  /** matched 행에서 같은 옵션을 가리키는 파일 행들. 1개면 기존과 동일한 단일 행. */
  members?: MatchedMember[]
}

type TabValue = 'all' | 'matched' | 'file-only'
type MatchedSub = 'all' | 'matched-diff' | 'matched-equal'

function entryStatusBadge(status: string) {
  switch (status) {
    case 'matched-diff':
      return <Badge className="border-amber-200 bg-amber-100 text-amber-700">차이있음</Badge>
    case 'matched-equal':
      return <Badge className="border-green-200 bg-green-100 text-green-700">일치</Badge>
    case 'file-only':
      return <Badge className="border-red-200 bg-red-100 text-red-700">미매칭</Badge>
    default:
      return null
  }
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

/** 매핑에 포함된 모든 옵션을 한 줄씩 나열 — 엔트리는 옵션 단위로 쪼개지므로 매핑 전체를 봐야 한다. */
function mappingItemsToLabel(items: MappingItem[]): string {
  if (items.length === 0) return '-'
  return items
    .map((i) => `${i.productName} / ${i.optionName}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`)
    .join('\n')
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
  const [tab, setTab] = useState<TabValue>('all')
  const [matchedSub, setMatchedSub] = useState<MatchedSub>('all')
  // externalCode → PickedOptionWithQty[] (다중 옵션+수량)
  const [manualMap, setManualMap] = useState<Record<string, PickedOptionWithQty[]>>({})
  // 수동 매칭한 옵션의 이 위치 현재 재고 (optionId → quantity). 매칭 즉시 조회해 현재재고·차이 표시.
  const [manualStock, setManualStock] = useState<Record<string, number>>({})

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerExternalCode, setPickerExternalCode] = useState<string | null>(null)
  const [pickerContext, setPickerContext] = useState('')
  const [pickerKeywordSource, setPickerKeywordSource] = useState('')

  // matched-* 행 매칭 수정용 picker 상태
  const [editMatcherOpen, setEditMatcherOpen] = useState(false)
  const [editMatcherEntry, setEditMatcherEntry] = useState<UnifiedEntry | null>(null)
  // 병합 행 접힘 상태. **접힌 키만** 담는다 — 기본값이 펼침이라 빈 Set = 전부 펼침.
  // 펼침 키를 담으면 새로 로드된 행이 기본 접힘이 돼 기본값 계약이 깨진다.
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set())

  // 시스템 쪽 미등장 옵션 다이얼로그
  const [unmatchedOpen, setUnmatchedOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/inventory/reconciliation/${reconciliationId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '조회 실패')
      setRecon(data.reconciliation as Reconciliation)
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

  const unifiedEntries = useMemo<UnifiedEntry[]>(() => {
    const result: UnifiedEntry[] = []

    // matched-* 는 옵션 단위로 병합한다. 서버(aggregateMatchedByOption)가 이미 목표 수량과
    // 차이를 그룹 기준으로 계산해 두었으므로, 여기서는 표현만 합친다 — 화면 숫자와 확정
    // 결과가 같은 함수에서 나와야 한다. groupKey 가 없는 응답(구버전)은 optionId 로 폴백.
    const groups = new Map<string, UnifiedEntry>()
    for (const e of [...diffEntries, ...equalEntries]) {
      const key = e.groupKey ?? `${e.optionId}`
      const member: MatchedMember = {
        fileCode: e.row.externalCode,
        fileProductName: e.row.externalName ?? e.row.externalCode,
        fileOptionName: e.row.externalOptionName ?? '-',
        fileRowQty: e.row.quantity,
        mapItemQuantity: e.mapItemQuantity,
        targetQty: e.fileQuantity,
        mappingId: e.mappingId,
        mappingItems: e.mappingItems,
        row: e.row,
      }
      const existing = groups.get(key)
      if (existing) {
        existing.members!.push(member)
        continue
      }
      groups.set(key, {
        key: `grp-${key}`,
        status: e.status,
        fileCode: member.fileCode,
        fileProductName: member.fileProductName,
        fileOptionName: member.fileOptionName,
        fileRowQty: member.fileRowQty,
        sysProductName: e.productName,
        sysOptionName: e.optionName,
        systemQty: e.systemQuantity,
        // 그룹 목표 = Σ 멤버 기여분. 서버가 준 groupFileQuantity 를 우선 신뢰한다.
        targetQty: e.groupFileQuantity ?? e.fileQuantity,
        delta: e.status === 'matched-diff' ? e.delta : 0,
        optionId: e.optionId,
        row: e.row,
        mappingId: e.mappingId,
        mappingItems: e.mappingItems,
        mapItemQuantity: e.mapItemQuantity,
        driftedSinceMatch: e.status === 'matched-diff' ? e.driftedSinceMatch : undefined,
        members: [member],
      })
    }
    result.push(...groups.values())

    fileOnlyEntries.forEach((e, i) => {
      const code = e.row.externalCode
      const items = manualMap[code]
      const isMapped = !!(items && items.length > 0)

      // 수동 매칭 시 현재 재고·차이 파생: 현재재고=Σ 옵션별 위치재고, 목표=Σ 파일수량×세트수량, 차이=목표−현재
      let sysQty: number | null = null
      let target: number | null = null
      let delta: number | null = null
      if (isMapped) {
        const hasStock = items!.every((i) => manualStock[i.optionId] !== undefined)
        if (hasStock) {
          const current = items!.reduce((s, i) => s + (manualStock[i.optionId] ?? 0), 0)
          target = items!.reduce((s, i) => s + e.row.quantity * i.quantity, 0)
          sysQty = current
          delta = target - current
        }
      }

      result.push({
        key: `file-${code}-${i}`,
        status: 'file-only',
        fileCode: code,
        fileProductName: e.row.externalName ?? code,
        fileOptionName: e.row.externalOptionName ?? '-',
        fileRowQty: e.row.quantity,
        sysProductName: isMapped ? manualItemsToProductLabel(items!) : null,
        sysOptionName: isMapped ? manualItemsToOptionLabel(items!) : null,
        systemQty: sysQty,
        targetQty: target,
        delta,
        isManualMatched: isMapped,
        sysItems: isMapped ? items : undefined,
        suggestions: e.suggestions,
        row: e.row,
      })
    })

    return result
  }, [diffEntries, equalEntries, fileOnlyEntries, manualMap, manualStock])

  // system-only 는 이 표의 대상이 아니다 — 방향이 반대라 [재고 데이터 없는 상품]이 담당한다.
  //
  // 단위 주의: 이 카운트는 **표에 실제로 그려지는 행 수**다. matched 는 옵션 단위로 병합돼
  // 있으므로 "상품 옵션 개수"이고, 헤더의 `총 N건 · 자동매칭 M건`(DB totalItems/matchedItems)은
  // **파일 행 수**다. 둘이 다른 건 버그가 아니다 — 한쪽에 맞춰 "고치면" 안 된다.
  const counts = useMemo(() => {
    const matchedDiff = unifiedEntries.filter((e) => e.status === 'matched-diff').length
    const matchedEqual = unifiedEntries.filter((e) => e.status === 'matched-equal').length
    const fileOnly = unifiedEntries.filter((e) => e.status === 'file-only').length
    return {
      all: matchedDiff + matchedEqual + fileOnly,
      matched: matchedDiff + matchedEqual,
      'matched-diff': matchedDiff,
      'matched-equal': matchedEqual,
      'file-only': fileOnly,
    }
  }, [unifiedEntries])

  const filteredEntries = useMemo(() => {
    if (tab === 'all') return unifiedEntries
    if (tab === 'file-only') return unifiedEntries.filter((e) => e.status === 'file-only')
    // matched
    return unifiedEntries.filter((e) => {
      if (e.status === 'file-only') return false
      if (matchedSub === 'all') return true
      return e.status === matchedSub
    })
  }, [unifiedEntries, tab, matchedSub])

  const isApplied = useCallback(
    (entry: UnifiedEntry): boolean => {
      if (entry.optionId && appliedOptionIds.includes(entry.optionId)) return true
      const items = manualMap[entry.fileCode]
      if (items && items.length > 0) {
        return items.every((i) => appliedOptionIds.includes(i.optionId))
      }
      return false
    },
    [appliedOptionIds, manualMap]
  )

  // 확정 시 실제로 재고에 반영될 건수.
  //  - 이미 적용된 건은 재적용 가드가 건너뛰므로 제외 (레거시 부분 적용 세션 대응)
  //  - ADJUSTMENT 는 옵션 단위 절대량 set 이라, 서로 다른 파일 행(외부 SKU)이 같은 옵션을
  //    가리키면 한 건으로 합쳐진다. 행 수로 세면 결과 토스트와 어긋난다.
  const pendingApplyCount = useMemo(() => {
    const optionIds = new Set<string>()
    for (const e of unifiedEntries) {
      if (isApplied(e)) continue
      if (e.status === 'matched-diff' && e.optionId) {
        optionIds.add(e.optionId)
      } else if (e.status === 'file-only' && e.isManualMatched) {
        for (const i of manualMap[e.fileCode] ?? []) optionIds.add(i.optionId)
      }
    }
    return optionIds.size
  }, [unifiedEntries, isApplied, manualMap])

  function openPicker(entry: UnifiedEntry) {
    setPickerExternalCode(entry.fileCode)
    const name = entry.row?.externalName ?? entry.fileCode
    const optionName = entry.row?.externalOptionName
    setPickerContext(optionName ? `${name} / ${optionName}` : name)
    // 파일 상품명 전체를 검색어로 밀어넣으면 한 글자만 달라도 0건 → 단어별 칩으로 넘긴다.
    setPickerKeywordSource(optionName ? `${name} ${optionName}` : name)
    setPickerOpen(true)
  }

  function handlePickedMulti(items: PickedOptionWithQty[]) {
    // 파서가 항상 externalCode를 채우므로 도달 불가. 다시는 무음으로 버리지 않는다.
    if (!pickerExternalCode) {
      setPickerOpen(false)
      toast.error('이 행은 매칭 키가 없어 저장할 수 없습니다')
      return
    }
    const code = pickerExternalCode
    setManualMap((m) => ({ ...m, [code]: items }))
    setPickerOpen(false)
    toast.success(`${manualItemsToLabel(items)} 매칭됨`)
    // 매칭 즉시 현재 재고 조회 → 현재재고·차이 표시(확정 전 검토용)
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

  function toggleExpanded(key: string) {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // 현재 필터에 보이는 병합 행 키. 일괄 토글은 화면에 보이는 것만 대상으로 한다
  // — 필터로 감춘 행까지 건드리면 탭을 바꿨을 때 상태가 설명되지 않는다.
  const mergedKeys = useMemo(
    () => filteredEntries.filter((e) => (e.members?.length ?? 0) > 1).map((e) => e.key),
    [filteredEntries]
  )
  const expandedCount = mergedKeys.filter((k) => !collapsedKeys.has(k)).length
  const allExpanded = mergedKeys.length > 0 && expandedCount === mergedKeys.length

  function toggleAll() {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      // 하나라도 펼쳐져 있으면 전부 접는다(= 정리), 전부 접혀 있으면 전부 펼친다.
      if (expandedCount > 0) for (const k of mergedKeys) next.add(k)
      else for (const k of mergedKeys) next.delete(k)
      return next
    })
  }

  /**
   * 병합 행에서 [매칭 수정]을 열 때 쓰는 멤버 시점 엔트리.
   * mappingId·mappingItems·row 는 외부코드 단위라 그룹 대표값을 쓰면 다른 SKU 의 매핑이 열린다.
   */
  function memberEntry(entry: UnifiedEntry, m: MatchedMember): UnifiedEntry {
    return {
      ...entry,
      fileCode: m.fileCode,
      fileProductName: m.fileProductName,
      fileOptionName: m.fileOptionName,
      fileRowQty: m.fileRowQty,
      mapItemQuantity: m.mapItemQuantity,
      targetQty: m.targetQty,
      mappingId: m.mappingId,
      mappingItems: m.mappingItems,
      row: m.row,
    }
  }

  function openEditMatcher(entry: UnifiedEntry) {
    setEditMatcherEntry(entry)
    setEditMatcherOpen(true)
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
  }

  // 재고 대조에서는 옵션 중복 항상 허용 — 한 옵션이 여러 외부코드(채널 상품 묶음)에 등장 가능.
  // 같은 외부코드 내 중복은 OptionPickerDialog의 multi-with-qty 토글이 자연스럽게 막음.
  const excludeOptionIds: string[] = []

  // 확정 = 차이 전량 반영 + 잠금. 되돌릴 수 없으므로 기준일·미반영 잔여를 문구에 드러낸다.
  async function handleConfirm() {
    if (!recon) return
    const snapshotStr = new Date(recon.snapshotDate).toISOString().slice(0, 10)
    // 대조 당시엔 일치했는데 이후 재고가 움직여 확정 대상에 새로 들어온 건 — 적용 범위가
    // 늘어나는 부분이므로 조용히 넘기지 않고 드러낸다.
    // "그중"이 반영 건수를 가리키도록 바로 다음 줄에 붙인다(순서가 뜻을 바꾼다).
    const drifted = unifiedEntries.filter((e) => e.driftedSinceMatch && !isApplied(e)).length
    const unmatched = unifiedEntries.filter(
      (e) => e.status === 'file-only' && !e.isManualMatched
    ).length
    const lines = [
      `${snapshotStr} 기준 파일 수량으로 재고 ${pendingApplyCount}건을 덮어씁니다.`,
      ...(drifted > 0
        ? [`그중 ${drifted}건은 대조 당시엔 일치했으나 이후 재고가 변동됐습니다.`]
        : []),
      ...(unmatched > 0 ? [`미매칭 ${unmatched}건은 반영되지 않습니다.`] : []),
      '확정 후에는 수정할 수 없습니다.',
    ]
    if (!confirm(lines.join('\n'))) return

    setSubmitting(true)
    try {
      const manualMappings = Object.entries(manualMap)
        .filter(([, items]) => items.length > 0)
        .map(([externalCode, items]) => ({
          externalCode,
          items: items.map((i) => ({ optionId: i.optionId, quantity: i.quantity })),
        }))

      const res = await fetch(`/api/sh/inventory/reconciliation/${recon.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', manualMappings }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '확정 실패')

      if (data.failed?.length) {
        toast.error(`${data.failed.length}건 실패 — 다시 시도해 주세요`)
        await load()
        onChanged?.()
        return
      }
      toast.success(`${data.adjustedCount}건 조정 완료 · 확정됨`)
      onConfirmed()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '확정 실패')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || !recon) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const isConfirmed = recon.status === 'CONFIRMED'
  const canEdit = !isConfirmed
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
            {isConfirmed &&
              recon.confirmedAt &&
              ` · 확정 ${new Date(recon.confirmedAt).toISOString().slice(0, 10)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setUnmatchedOpen(true)}>
            <PackageSearch className="mr-1 h-3.5 w-3.5" />
            재고 데이터 없는 상품
          </Button>
          {!isConfirmed && (
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={submitting || pendingApplyCount === 0}
              title={pendingApplyCount === 0 ? '반영할 차이 없음' : undefined}
            >
              {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              확정 (재고 반영 {pendingApplyCount}건)
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex gap-1 rounded-lg border bg-muted p-1">
          {(
            [
              { value: 'all', label: '전체', count: counts.all },
              { value: 'matched', label: '매칭', count: counts.matched },
              { value: 'file-only', label: '미매칭', count: counts['file-only'] },
            ] as const
          ).map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setTab(f.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === f.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-xs opacity-70">{f.count}</span>
            </button>
          ))}
        </div>

        {/* 매칭 탭 2차 세그먼트 — 차이/일치 */}
        {tab === 'matched' && (
          <div className="flex gap-1 rounded-lg border p-1">
            {(
              [
                { value: 'all', label: '전체', count: counts.matched },
                { value: 'matched-diff', label: '차이', count: counts['matched-diff'] },
                { value: 'matched-equal', label: '일치', count: counts['matched-equal'] },
              ] as const
            ).map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setMatchedSub(f.value)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  matchedSub === f.value
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {f.label}
                <span className="ml-1 opacity-70">{f.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* 일괄 펼치기/접기 — 병합 행이 있을 때만. 기본은 전부 펼침이라
            처음엔 '모두 접기'로 보인다. */}
        {mergedKeys.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={toggleAll}
            aria-expanded={allExpanded}
          >
            {expandedCount > 0 ? (
              <>
                <ChevronsDownUp className="mr-1 h-3.5 w-3.5" />
                모두 접기
              </>
            ) : (
              <>
                <ChevronsUpDown className="mr-1 h-3.5 w-3.5" />
                모두 펼치기
              </>
            )}
            <span className="ml-1 opacity-60">
              {expandedCount}/{mergedKeys.length}
            </span>
          </Button>
        )}
      </div>

      {filteredEntries.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          해당 상태의 항목이 없습니다
        </div>
      ) : (
        // Table 프리미티브가 자체 overflow-x-auto 래퍼를 가지므로 여기서 또 감싸지 않는다.
        // table-fixed 로 고정폭을 강제해야 긴 한글 상품명이 컬럼을 밀어내지 않는다.
        <div className="rounded-md border">
          <Table className="table-fixed">
            {/* table-fixed 는 첫 행으로 폭을 정하는데 1단이 colSpan 그룹 헤더라 개별 폭을
                줄 수 없다. colgroup 으로 못박아야 숫자 컬럼이 균등 분배되지 않는다.
                폭 없는 2개(상품·옵션)가 남는 공간을 나눠 갖는다. */}
            {/* table-fixed 는 첫 행으로 폭을 정하는데 1단이 colSpan 그룹 헤더라 개별 폭을
                줄 수 없다. colgroup 으로 못박아야 숫자 컬럼이 균등 분배되지 않는다.
                폭 없는 2개(상품·옵션)가 남는 공간을 나눠 갖는다.
                컬럼 순서: 시스템 재고 → 파일 데이터 → 상태 → 차이 → 동작.
                기준(시스템)을 먼저 읽고 대조 대상(파일)을 보게 하는 순서다. */}
            <colgroup>
              <col />
              <col className="w-[68px]" />
              <col />
              <col className="w-[72px]" />
              <col className="w-[80px]" />
              <col className="w-[64px]" />
              {/* [상품 선택] 아이콘+텍스트가 가장 넓다. 좁히면 셀을 밀고 나가 표가 넘친다. */}
              <col className="w-[108px]" />
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
              {/* 1단: 기준 그룹 — 어느 값이 파일에서 왔는지 라벨로 못박는다 */}
              <TableRow className="hover:bg-transparent">
                <TableHead colSpan={2} className="text-center text-xs">
                  시스템 재고
                </TableHead>
                <TableHead colSpan={2} className="border-l bg-muted/40 text-center text-xs">
                  파일 데이터
                </TableHead>
                <TableHead className="border-l" />
                <TableHead />
                <TableHead />
              </TableRow>
              <TableRow>
                {/* 상품명·옵션명·SKU 를 한 셀에 쌓는다. 파일/시스템 상품명이 거의 같은 문자열이라
                    각각 컬럼을 주면 폭만 먹고 정보는 늘지 않았다. */}
                <TableHead>상품 · 옵션</TableHead>
                {/* 확정·삭제된 대조는 닫힌 기록이라 매칭 시점 값을 그대로 보여준다.
                    "현재고"라고 부르면 거짓말이 된다. */}
                <TableHead className="text-right">{isConfirmed ? '대조시점' : '현재고'}</TableHead>
                <TableHead className="border-l bg-muted/40">상품 · 옵션</TableHead>
                <TableHead className="bg-muted/40 text-right">수량</TableHead>
                <TableHead className="border-l">상태</TableHead>
                <TableHead className="text-right">차이</TableHead>
                <TableHead className="whitespace-nowrap">동작</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((entry) => {
                const applied = isApplied(entry)
                const isMapped = (manualMap[entry.fileCode]?.length ?? 0) > 0
                // 수동 매칭 행은 옵션 전체를 펼쳐 보여준다(라벨 접기 대신).
                const sysItems = entry.sysItems && entry.sysItems.length > 0 ? entry.sysItems : null
                const sysProductNames = sysItems
                  ? Array.from(new Set(sysItems.map((i) => i.productName)))
                  : null
                const sysProductTitle = sysProductNames ? sysProductNames.join(', ') : null
                // 1:N 매핑은 옵션당 한 행이라, 행 하나만 보면 같은 파일 행이 어디에 더 걸렸는지 알 수 없다.
                // 색(흐림)만으로 구분하지 않도록 "함께 매칭" 레이블을 붙여 명시한다.
                const siblingItems = (
                  entry.members
                    ? entry.members.flatMap((m) => m.mappingItems ?? [])
                    : (entry.mappingItems ?? [])
                ).filter(
                  (i, idx, arr) =>
                    i.optionId !== entry.optionId &&
                    arr.findIndex((x) => x.optionId === i.optionId) === idx
                )
                const siblingLabels = siblingItems.map(
                  (i) => `${i.optionName}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`
                )
                const siblingText =
                  siblingLabels.length > 3
                    ? `${siblingLabels.slice(0, 3).join(', ')} 외 ${siblingLabels.length - 3}개`
                    : siblingLabels.join(', ')
                // 축 B 병합 — 같은 옵션을 가리키는 파일 행들. 1개면 기존 단일 행 표기 그대로.
                const members = entry.members ?? []
                const isMerged = members.length > 1
                const expanded = !collapsedKeys.has(entry.key)
                const fileCellClass = 'bg-muted/40'

                const statusCell = applied ? (
                  <Badge className="border-green-200 bg-green-100 text-green-700">적용됨</Badge>
                ) : entry.status === 'file-only' && entry.isManualMatched ? (
                  <Badge className="border-blue-200 bg-blue-100 text-blue-700">매칭됨</Badge>
                ) : (
                  entryStatusBadge(entry.status)
                )

                return (
                  <Fragment key={entry.key}>
                    <TableRow className={applied ? 'bg-green-50/30' : undefined}>
                      {/* ── 시스템 재고 ── */}
                      <TableCell>
                        {entry.sysProductName === null ? (
                          <span className="text-muted-foreground/50">—</span>
                        ) : (
                          <>
                            <div
                              className="truncate font-medium"
                              title={sysProductTitle ?? entry.sysProductName}
                            >
                              {sysProductTitle ?? entry.sysProductName}
                            </div>
                            <div
                              className={`gap-1 text-xs text-muted-foreground ${
                                // 옵션이 여러 줄이면 버튼을 아래로 내려 옵션 표기가 잘리지 않게 한다.
                                sysItems && sysItems.length > 1
                                  ? 'flex flex-col items-start'
                                  : 'flex items-start'
                              }`}
                            >
                              {sysItems ? (
                                // 수동 매칭은 옵션 여러 개를 한 행에 담으므로 접지 않고 모두 나열한다.
                                <span className="w-full min-w-0">
                                  {sysItems.map((it) => (
                                    <span key={it.optionId} className="block truncate">
                                      {it.optionName}
                                      {it.quantity > 1 && (
                                        <span className="ml-1 opacity-70">
                                          × {it.quantity} = {entry.fileRowQty * it.quantity}
                                        </span>
                                      )}
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span className="truncate">
                                  {entry.sysOptionName}
                                  {/* 세트 수량 비율이 1 초과면 목표 수량이 파일 수량과 다르다.
                                      병합 행은 멤버마다 비율이 달라 펼침 행에서 보여준다. */}
                                  {!isMerged &&
                                    entry.mapItemQuantity !== undefined &&
                                    entry.mapItemQuantity > 1 && (
                                      <span className="ml-1 opacity-70">
                                        × {entry.mapItemQuantity} = {entry.targetQty}
                                      </span>
                                    )}
                                </span>
                              )}
                              {canEdit && isMapped && (
                                <span className="flex shrink-0 items-center gap-0.5">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 px-1 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                                    onClick={() => openPicker(entry)}
                                  >
                                    수정
                                  </Button>
                                  <span className="text-muted-foreground/40">·</span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 px-1 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-destructive"
                                    onClick={() => removeMapping(entry.fileCode)}
                                  >
                                    취소
                                  </Button>
                                </span>
                              )}
                            </div>
                            {siblingLabels.length > 0 && (
                              <div
                                className="truncate text-xs text-muted-foreground"
                                title={`함께 매칭: ${siblingLabels.join(', ')}`}
                              >
                                함께 매칭: {siblingText}
                              </div>
                            )}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {entry.systemQty !== null ? entry.systemQty : '-'}
                      </TableCell>

                      {/* ── 파일 데이터 ── 병합 행은 SKU 개수만 보여주고 세부는 펼침으로 */}
                      <TableCell className={`border-l ${fileCellClass}`}>
                        {isMerged ? (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(entry.key)}
                            aria-expanded={expanded}
                            className="flex w-full items-center gap-1 rounded text-left text-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            <ChevronRight
                              className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                                expanded ? 'rotate-90' : ''
                              }`}
                            />
                            <span className="font-medium">SKU {members.length}개</span>
                          </button>
                        ) : (
                          <>
                            <div className="truncate font-medium" title={entry.fileProductName}>
                              {entry.fileProductName}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {entry.fileOptionName}
                              {!isSyntheticExternalCode(entry.fileCode) && (
                                <span className="ml-1.5 font-mono opacity-70">
                                  {entry.fileCode}
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold tabular-nums ${fileCellClass}`}
                      >
                        {/* 병합 행의 수량은 옵션 목표 수량(Σ 멤버 기여분) — 확정이 실제로 쓰는 값 */}
                        {isMerged ? entry.targetQty : entry.fileRowQty}
                      </TableCell>

                      <TableCell className="border-l">{statusCell}</TableCell>

                      {/* 차이 = 이 화면의 핵심 신호. 0 은 눌러서 시선이 0 아닌 값에 가게 한다. */}
                      <TableCell
                        className={`text-right font-mono tabular-nums ${
                          entry.delta === null
                            ? ''
                            : entry.delta > 0
                              ? 'font-semibold text-emerald-600'
                              : entry.delta < 0
                                ? 'font-semibold text-red-600'
                                : 'text-muted-foreground/60'
                        }`}
                      >
                        {entry.delta !== null ? `${entry.delta > 0 ? '+' : ''}${entry.delta}` : '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {/* 병합 행의 [매칭 수정]은 펼침 행에 있다 — mappingId 가 외부코드 단위라
                            어느 SKU 를 고치는지가 위치로 자명해야 한다. */}
                        {canEdit &&
                          !isMerged &&
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
                        {canEdit && entry.status === 'file-only' && (
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
                      </TableCell>
                    </TableRow>

                    {/* 펼침 — 구성 SKU 별 기여분. 합계가 위 행의 수량과 맞는지 눈으로 검산된다. */}
                    {isMerged &&
                      expanded &&
                      members.map((m, mi) => (
                        <TableRow
                          key={`${entry.key}-m${mi}`}
                          className="bg-muted/20 hover:bg-muted/30"
                        >
                          <TableCell />
                          <TableCell />
                          <TableCell className={`border-l ${fileCellClass} pl-7`}>
                            <div className="truncate text-sm" title={m.fileProductName}>
                              {m.fileProductName}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {m.fileOptionName}
                              {!isSyntheticExternalCode(m.fileCode) && (
                                <span className="ml-1.5 font-mono opacity-70">{m.fileCode}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className={`text-right tabular-nums ${fileCellClass}`}>
                            <div>{m.fileRowQty}</div>
                            {m.mapItemQuantity > 1 && (
                              <div className="text-xs text-muted-foreground">
                                × {m.mapItemQuantity} = {m.targetQty}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="border-l" />
                          <TableCell />
                          <TableCell className="whitespace-nowrap">
                            {canEdit && m.mappingId && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => openEditMatcher(memberEntry(entry, m))}
                              >
                                매칭 수정
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* file-only 행 수동 매칭 picker */}
      <OptionPickerDialog
        open={pickerOpen}
        onOpenChange={(v) => {
          if (!v) setPickerOpen(false)
        }}
        mode="multi-with-qty"
        onPickMulti={handlePickedMulti}
        keywordSource={pickerKeywordSource}
        tokenized
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
        keywordSource={editMatcherEntry?.row?.externalName ?? ''}
        tokenized
        contextLabel="현재 매칭"
        contextValue={
          editMatcherEntry
            ? editMatcherEntry.mappingItems && editMatcherEntry.mappingItems.length > 0
              ? mappingItemsToLabel(editMatcherEntry.mappingItems)
              : `${editMatcherEntry.sysProductName ?? ''} / ${editMatcherEntry.sysOptionName ?? ''}`
            : ''
        }
        secondaryContextLabel="매칭된 파일 상품명"
        secondaryContextValue={
          editMatcherEntry
            ? `${editMatcherEntry.fileProductName}${
                editMatcherEntry.fileOptionName && editMatcherEntry.fileOptionName !== '-'
                  ? ` / ${editMatcherEntry.fileOptionName}`
                  : ''
              }${editMatcherEntry.fileCode ? ` (${editMatcherEntry.fileCode})` : ''}`
            : ''
        }
        initialItems={
          editMatcherEntry?.mappingItems
            ? mappingItemsToPickedWithQty(editMatcherEntry.mappingItems)
            : undefined
        }
      />

      {/* 시스템 쪽 미등장 옵션 — 확정 여부와 무관하게 열람·SKU 연결 가능 */}
      <ReconciliationUnmatchedOptionsDialog
        open={unmatchedOpen}
        onOpenChange={setUnmatchedOpen}
        reconciliationId={recon.id}
        locationId={recon.location.id}
        locationName={recon.location.name}
        onLinked={() => {
          void load()
          onChanged?.()
        }}
      />
    </div>
  )
}
