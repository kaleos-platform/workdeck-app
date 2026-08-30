'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  Layers,
  Loader2,
  Lock,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  SELLER_HUB_LISTING_NEW_PATH,
  SELLER_HUB_LISTINGS_PATH,
  getSellerHubPricingScenarioPath,
} from '@/lib/deck-routes'
import { SaveStatusChip } from '@/components/sh/save-status-chip'
import { computeDiscount, computeEffectiveStatus } from '@/lib/sh/listing-calc'
import { resolveKeywordRules, withChannelDefaults } from '@/lib/sh/keyword-rules'
import { diffKeywordChange } from '@/lib/sh/keyword-change'
import { normalizeKeyword } from '@/lib/sh/keyword-normalize'
import {
  type OptionAttribute,
  applyBaseRename,
  buildSuffix,
  deriveBaseValues,
  joinName,
} from '@/lib/sh/listing-name-propagation'

import { NameDraftDialog } from '../keywords/name-draft-dialog'
import { useNameDraft } from '../keywords/use-name-draft'
import { RegisterKeywordsButton } from '../keywords/register-keywords-button'
import { KeywordEditor } from './keyword-editor'
import { KeywordChangeDialog, type KeywordChangeMeta } from './keyword-change-dialog'
import { KeywordChangeTimeline } from './keyword-change-timeline'
import { GroupListingsTable, type GroupListingRow } from './group-listings-table'
import { GroupBulkEditBar, type BulkPatch } from './group-bulk-edit-bar'
import { GroupBaseInfoCard } from './group-base-info-card'
import { CompositionBuilder, type BuiltGroup, type ProductContext } from './composition-builder'
import { PricingScenarioHistoryPanel } from '../pricing-sim/pricing-scenario-history-panel'

/** 게이트 보류 중 잠기는 액션의 안내 문구 */
const GATE_BLOCK_HINT = '상품명·검색어 변경 사유를 먼저 입력해 주세요'

type GroupListingFull = GroupListingRow & {
  memo: string | null
}

type SingleProduct = {
  kind: 'single'
  id: string
  name: string
  internalName: string | null
  displayName: string
  brand: { id: string; name: string } | null
  optionAttributes: OptionAttribute[]
  msrp: number | null
}

type MixedProduct = {
  kind: 'mixed'
  /** 혼합 구성의 첫 product 기반 backward-compat 필드 (표시 전용) */
  id: string
  name: string
  internalName: string | null
  displayName: string
  brand: { id: string; name: string } | null
  optionAttributes: OptionAttribute[]
  msrp: number | null
  products: Array<{ id: string; name: string }>
}

type ProductUnion = SingleProduct | MixedProduct

type GroupDetail = {
  product: ProductUnion
  channel: {
    id: string
    name: string
    externalSource: string | null
    channelTypeDef: { id: string; name: string; isSalesChannel: boolean } | null
  }
  channelProduct: {
    id: string
    baseSearchName: string
    baseDisplayName: string | null
    baseManagementName: string | null
    baseInternalCode: string | null
    memo: string | null
    keywords: string[]
  }
  listings: GroupListingFull[]
}

type Props = {
  channelProductId: string
}

export function GroupDetailView({ channelProductId }: Props) {
  const router = useRouter()
  const [data, setData] = useState<GroupDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  // chip 표시용 재시도 횟수 (ref는 로직용, state는 UI 반응용)
  const [retryCount, setRetryCount] = useState(0)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 자동 재시도 (실패 후 backoff): 10s → 30s → 60s 후 수동 전환
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoRetryCountRef = useRef(0)
  const AUTO_RETRY_DELAYS = [10_000, 30_000, 60_000]

  // 편집 state
  const [keywords, setKeywords] = useState<string[]>([])
  const [rows, setRows] = useState<GroupListingFull[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // 기본 정보 편집 state
  const [baseSearchName, setBaseSearchName] = useState('')
  const [baseDisplayName, setBaseDisplayName] = useState('')
  const [baseManagementName, setBaseManagementName] = useState('')
  const [baseInternalCode, setBaseInternalCode] = useState('')
  const [memo, setMemo] = useState('')

  // 옵션 CRUD state
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; label: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [addBuilderOpen, setAddBuilderOpen] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resetBuilderOpen, setResetBuilderOpen] = useState(false)
  const [mutating, setMutating] = useState(false)

  // 그룹 단위 액션 state
  const [groupSuspendOpen, setGroupSuspendOpen] = useState(false)
  const [groupDeleteOpen, setGroupDeleteOpen] = useState(false)
  const [groupActionLoading, setGroupActionLoading] = useState(false)

  // §25-26 변경 게이트
  const [gateOpen, setGateOpen] = useState(false)
  const [historyKey, setHistoryKey] = useState(0)

  // AI 초안 다이얼로그 2종(상품명·키워드) — useNameDraft 훅 하나를 공유해 화면 방문당
  // API 호출을 1회로 고정한다(아래 productId 확정 후 호출).
  const [nameDraftOpen, setNameDraftOpen] = useState(false)
  const [keywordDraftOpen, setKeywordDraftOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/products/listings/channel-products/${channelProductId}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('채널 상품 조회 실패')
      const d: GroupDetail = await res.json()
      setData(d)
      setKeywords(d.channelProduct.keywords ?? [])
      setRows(d.listings)
      setSelected(new Set())
      // single 모드에서만 자동 suffix 추출. mixed는 channel-product 기본값 사용.
      if (d.product.kind === 'single') {
        const derived = deriveBaseValues(
          d.listings.map((l) => ({
            id: l.id,
            searchName: l.searchName,
            displayName: l.displayName,
            managementName: l.managementName,
            internalCode: l.internalCode,
            memo: l.memo,
            items: l.items.map((it) => ({
              optionId: it.optionId,
              attributeValues: it.attributeValues,
            })),
          })),
          d.product.optionAttributes
        )
        setBaseSearchName(derived.baseSearchName)
        setBaseDisplayName(derived.baseDisplayName)
        setBaseManagementName(derived.baseManagementName)
        setBaseInternalCode(derived.baseInternalCode)
        setMemo(derived.memo)
      } else {
        // mixed 모드: channel-product 저장값을 직접 사용
        setBaseSearchName(d.channelProduct.baseSearchName)
        setBaseDisplayName(d.channelProduct.baseDisplayName ?? '')
        setBaseManagementName(d.channelProduct.baseManagementName ?? '')
        setBaseInternalCode(d.channelProduct.baseInternalCode ?? '')
        setMemo(d.channelProduct.memo ?? '')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '채널 상품 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [channelProductId])

  useEffect(() => {
    load()
  }, [load])

  // 구매옵션 중복 검증(§22 STEP08)용. 상품명·브랜드 토큰은 추천에 쓰지 않는다
  // (§10 Rule 1 이 금지하는 "상품명 중복"을 유도했던 로직).
  const optionNames = useMemo(() => {
    if (!data) return []
    const set = new Set<string>()
    for (const l of data.listings) {
      for (const it of l.items) set.add(it.optionName)
    }
    return Array.from(set)
  }, [data])

  // 연동 채널(externalSource != null)이면 이 화면에서 상품명·검색어를 읽기전용으로 잠근다.
  // §키워드 관리 카드(product-keyword-card.tsx)와 같은 판정 기준이다. 이 잠금은 순수
  // 클라이언트 UX 규칙이다 — PATCH 라우트는 externalSource 를 검사하지 않으므로, 이 화면을
  // 우회해 API 를 직접 호출하면 서버는 여전히 값을 받아들인다.
  const readOnly = data?.channel.externalSource != null

  // 기본 정보 카드와 같은 채널 기준 규칙셋. DB 오버라이드(ChannelKeywordRule)는 아직 서버에서
  // 내려오는 경로가 없어 resolveKeywordRules(null) 로 기본값만 쓴다.
  // 이 카드와 GroupBaseInfoCard 가 각자 계산하면 한쪽만 고칠 때 재발하므로 여기서 한 번만
  // 만들어 props 로 내려보낸다.
  const channelName = data?.channel.name ?? null
  const channelExternalSource = data?.channel.externalSource ?? null
  const rules = useMemo(
    () =>
      withChannelDefaults(
        resolveKeywordRules(null),
        channelName ? { name: channelName, externalSource: channelExternalSource } : null
      ),
    [channelName, channelExternalSource]
  )

  // 키워드 마스터 추천 — single 상품일 때만 조회한다. mixed 는 여러 상품이 섞여 있어 어느
  // 상품 추천인지 특정할 수 없으므로 빈 배열로 둔다. 실패는 조용히 무시(부가 기능).
  // AI 초안(상품명·키워드) 도 같은 이유로 mixed 에서는 쓸 수 없다 — mixed 의 backward-compat
  // id(data.product.id)를 여기 쓰면 안 된다. 다른 상품이 섞여 나간다(위 SingleProduct/MixedProduct
  // 타입 주석 참조).
  const productId = data?.product.kind === 'single' ? data.product.id : null
  // 연동 채널이면 상품명·검색어가 잠기므로 AI 초안도 의미가 없다 — productId 를 null 로 두어
  // 훅이 아예 fetch 하지 않게 한다.
  const draft = useNameDraft(readOnly ? null : productId, data?.channel.id ?? '')
  const [suggestions, setSuggestions] = useState<string[]>([])
  useEffect(() => {
    if (!productId) {
      setSuggestions([])
      return
    }
    let cancelled = false
    // 추천 제외 기준을 편집기 검증과 맞춘다 — 서버 기본값은 공식 상품명이라, 그대로 두면
    // 추천 칩을 누르는 순간 편집기가 위반으로 표시하는 모순이 생긴다.
    // 저장된 값(state 가 아니라 data)을 쓴다 — 타이핑마다 재조회되면 안 된다.
    const suggestName = data?.channelProduct.baseSearchName ?? ''
    const query = new URLSearchParams({ productId })
    if (suggestName) query.set('searchName', suggestName)
    fetch(`/api/sh/keywords/suggest?${query.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { suggestions?: string[] }) => {
        if (cancelled) return
        setSuggestions(data.suggestions ?? [])
      })
      .catch(() => {
        if (cancelled) return
        setSuggestions([])
      })
    return () => {
      cancelled = true
    }
  }, [productId, data?.channelProduct.baseSearchName])

  // 조회 시점 이후 사용자가 방금 추가한 키워드는 걸러낸다.
  const keywordSuggestions = useMemo(() => {
    if (suggestions.length === 0) return []
    const existing = new Set(keywords.map((k) => normalizeKeyword(k)))
    return suggestions.filter((s) => !existing.has(normalizeKeyword(s)))
  }, [suggestions, keywords])

  const derivedBase = useMemo(() => {
    if (!data) return null
    // mixed 모드는 suffix 자동 추출 불필요 — null 반환
    if (data.product.kind !== 'single') return null
    return deriveBaseValues(
      data.listings.map((l) => ({
        id: l.id,
        searchName: l.searchName,
        displayName: l.displayName,
        managementName: l.managementName,
        internalCode: l.internalCode,
        memo: l.memo,
        items: l.items.map((it) => ({
          optionId: it.optionId,
          attributeValues: it.attributeValues,
        })),
      })),
      data.product.optionAttributes
    )
  }, [data])

  const baseDirty = useMemo(() => {
    if (!data) return false
    if (data.product.kind === 'single') {
      // single: derived suffix 기반 비교
      if (!derivedBase) return false
      return (
        baseSearchName !== derivedBase.baseSearchName ||
        baseDisplayName !== derivedBase.baseDisplayName ||
        baseManagementName !== derivedBase.baseManagementName ||
        baseInternalCode !== derivedBase.baseInternalCode ||
        memo !== derivedBase.memo
      )
    }
    // mixed: channel-product 저장값과 직접 비교
    return (
      baseSearchName !== data.channelProduct.baseSearchName ||
      baseDisplayName !== (data.channelProduct.baseDisplayName ?? '') ||
      baseManagementName !== (data.channelProduct.baseManagementName ?? '') ||
      baseInternalCode !== (data.channelProduct.baseInternalCode ?? '') ||
      memo !== (data.channelProduct.memo ?? '')
    )
  }, [
    data,
    derivedBase,
    baseSearchName,
    baseDisplayName,
    baseManagementName,
    baseInternalCode,
    memo,
  ])

  const keywordsDirty = useMemo(() => {
    const original = data?.channelProduct.keywords ?? []
    if (keywords.length !== original.length) return true
    return keywords.some((k, i) => k !== original[i])
  }, [keywords, data])

  const dirtyRowIds = useMemo(() => {
    const set = new Set<string>()
    if (!data) return set
    const origById = new Map(data.listings.map((l) => [l.id, l]))
    for (const r of rows) {
      const o = origById.get(r.id)
      if (!o) continue
      if (
        r.retailPrice !== o.retailPrice ||
        r.channelStock !== o.channelStock ||
        r.status !== o.status
      ) {
        set.add(r.id)
      }
    }
    return set
  }, [rows, data])

  const totalDirty = baseDirty || keywordsDirty || dirtyRowIds.size > 0
  const dirtyCount = (baseDirty ? 1 : 0) + (keywordsDirty ? 1 : 0) + dirtyRowIds.size

  // §25-26 게이트 판정.
  //
  // dirty 와는 다른 잣대를 쓴다. dirty 는 "저장 요청을 보낼 것인가"(순서 변경 포함)이고,
  // 게이트는 "채널에 나가는 값이 실제로 달라지는가"(집합·공백 정규화 비교)다. 그래서
  // 칩 순서만 바꾼 저장은 게이트 없이 지나간다 — 서버도 그런 변경은 기록하지 않는다.
  //
  // 비교 대상은 화면의 파생값이 아니라 ChannelProduct 저장값이다. 서버(CP PATCH)가 같은
  // 기준으로 before/after 와 multiChange 를 계산하므로 다이얼로그가 보여주는 diff 와
  // 실제로 남는 이력이 어긋나지 않는다.
  const nameToSave = baseDirty ? baseSearchName : (data?.channelProduct.baseSearchName ?? '')
  const savedKeywords = data?.channelProduct.keywords
  const keywordsToSave = useMemo(
    () => (keywordsDirty ? keywords : (savedKeywords ?? [])),
    [keywordsDirty, keywords, savedKeywords]
  )
  const keywordChange = useMemo(
    () =>
      diffKeywordChange({
        beforeName: data?.channelProduct.baseSearchName,
        afterName: nameToSave,
        beforeKeywords: data?.channelProduct.keywords ?? [],
        afterKeywords: keywordsToSave,
      }),
    [data?.channelProduct.baseSearchName, data?.channelProduct.keywords, nameToSave, keywordsToSave]
  )
  const gateNeeded = keywordChange.changed

  function handleRowChange(id: string, patch: BulkPatch) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        const next = { ...r }
        if (patch.retailPrice !== undefined) next.retailPrice = patch.retailPrice
        if (patch.channelStock !== undefined) next.channelStock = patch.channelStock
        if (patch.status !== undefined) next.status = patch.status
        if (patch.status !== undefined || patch.channelStock !== undefined) {
          // 채널 재고는 가용 재고에 영향 없음 — 품절 판정에만 반영
          next.effectiveStatus = computeEffectiveStatus(
            next.status,
            next.availableStock,
            next.channelStock
          )
        }
        const discount = computeDiscount(next.baselinePrice, next.retailPrice)
        next.discountAmount = discount.diff
        next.discountPercent = discount.percent
        return next
      })
    )
    scheduleAutoSave(patch.status !== undefined ? 0 : 400)
  }

  function applyBulkPatch(patch: BulkPatch) {
    if (selected.size === 0) return
    setRows((prev) =>
      prev.map((r) => {
        if (!selected.has(r.id)) return r
        const next = { ...r }
        if (patch.retailPrice !== undefined) next.retailPrice = patch.retailPrice
        if (patch.channelStock !== undefined) next.channelStock = patch.channelStock
        if (patch.status !== undefined) next.status = patch.status
        next.effectiveStatus = computeEffectiveStatus(
          next.status,
          next.availableStock,
          next.channelStock
        )
        const discount = computeDiscount(next.baselinePrice, next.retailPrice)
        next.discountAmount = discount.diff
        next.discountPercent = discount.percent
        return next
      })
    )
    toast.success(`${selected.size}개 판매 옵션에 적용했습니다`)
    scheduleAutoSave(patch.status !== undefined ? 0 : 400)
  }

  function handleKeywordsChange(next: string[]) {
    setKeywords(next)
    scheduleAutoSave(0)
  }

  // AI 키워드 다이얼로그 전용 — KeywordEditor 의 개별 Enter 커밋(handleKeywordsChange, 0ms)과
  // 다르다. 다이얼로그에서 칩을 연속으로 누르면 클릭마다 0ms 저장이 걸려 요청이 난립하므로
  // 800ms 로 묶어 디바운스한다. product-keyword-card.tsx 의 handleAddKeyword 와 같은 중복
  // 판정(정규화 기준)을 쓴다.
  function handleAddKeywordFromDraft(keyword: string) {
    setKeywords((prev) => {
      const existing = new Set(prev.map((k) => normalizeKeyword(k)))
      if (existing.has(normalizeKeyword(keyword))) return prev
      return [...prev, keyword]
    })
    scheduleAutoSave(800)
  }

  // 진단이 제거를 권한 키워드를 지운다. 자동저장은 게이트를 우회하지 않는다 — runAutoSave 는
  // 사유가 필요한데 없으면 keywords 를 body 에 아예 담지 않으므로, 실제 반영은 사용자가
  // 변경 사유를 입력해 저장할 때 일어난다. 디바운스는 유지해야 다른 dirty 필드와 같은
  // 사이클에 처리되고 게이트 칩이 즉시 갱신된다.
  function handleRemoveKeywordFromDraft(keyword: string) {
    const target = normalizeKeyword(keyword)
    setKeywords((prev: string[]) => prev.filter((k) => normalizeKeyword(k) !== target))
    scheduleAutoSave(800)
  }

  async function handleCopyKeywords() {
    const clipboardText = keywords
      .map((keyword: string) => keyword.trim())
      .filter(Boolean)
      .join(',')

    if (!clipboardText) {
      toast.info('복사할 키워드가 없습니다')
      return
    }

    try {
      await navigator.clipboard.writeText(clipboardText)
      toast.success(`키워드 ${clipboardText.split(',').length}개를 복사했습니다`)
    } catch {
      toast.error('키워드 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요')
    }
  }

  function handleBaseChange(
    field: 'searchName' | 'displayName' | 'managementName' | 'internalCode' | 'memo',
    value: string
  ) {
    if (field === 'searchName') setBaseSearchName(value)
    else if (field === 'displayName') setBaseDisplayName(value)
    else if (field === 'managementName') setBaseManagementName(value)
    else if (field === 'internalCode') setBaseInternalCode(value)
    else setMemo(value)
    scheduleAutoSave(800)
  }

  // ─── 옵션 CRUD 핸들러 ──────────────────────────────────────────
  function requestDeleteOne(id: string) {
    const row = rows.find((r) => r.id === id)
    if (!row) return
    setDeleteTarget({ ids: [id], label: row.searchName })
  }

  function requestDeleteSelected() {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    const first = rows.find((r) => r.id === ids[0])
    const label = ids.length === 1 && first ? first.searchName : `${ids.length}개 판매 옵션`
    setDeleteTarget({ ids, label })
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    await flushPendingSave()
    setDeleting(true)
    const failures: string[] = []
    await Promise.all(
      deleteTarget.ids.map(async (id) => {
        try {
          const res = await fetch(`/api/sh/products/listings/${id}`, { method: 'DELETE' })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            failures.push(`${id}: ${err?.message ?? '삭제 실패'}`)
          }
        } catch (err) {
          failures.push(`${id}: ${err instanceof Error ? err.message : '삭제 실패'}`)
        }
      })
    )
    setDeleting(false)
    setDeleteTarget(null)
    setSelected(new Set())
    if (failures.length > 0) {
      toast.warning(`일부 삭제 실패 (${failures.length}건)`)
    } else {
      toast.success(`${deleteTarget.ids.length}개 판매 옵션이 삭제되었습니다`)
    }
    await load()
  }

  const allSuspended = data ? data.listings.every((l) => l.effectiveStatus !== 'ACTIVE') : false

  async function confirmGroupSuspendToggle() {
    if (!data) return
    await flushPendingSave()
    setGroupActionLoading(true)
    const targetStatus: 'ACTIVE' | 'SUSPENDED' = allSuspended ? 'ACTIVE' : 'SUSPENDED'
    const failures: string[] = []
    await Promise.all(
      data.listings.map(async (l) => {
        if (l.status === targetStatus) return
        try {
          const res = await fetch(`/api/sh/products/listings/${l.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: targetStatus }),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            failures.push(`${l.searchName}: ${err?.message ?? '실패'}`)
          }
        } catch (err) {
          failures.push(`${l.searchName}: ${err instanceof Error ? err.message : '실패'}`)
        }
      })
    )
    setGroupActionLoading(false)
    setGroupSuspendOpen(false)
    if (failures.length > 0) {
      toast.warning(`일부 처리 실패 (${failures.length}건)`)
    } else {
      toast.success(
        targetStatus === 'SUSPENDED'
          ? '판매채널 상품을 비활성화했습니다'
          : '판매채널 상품을 활성화했습니다'
      )
    }
    await load()
  }

  async function confirmGroupDelete() {
    if (!data) return
    if (!allSuspended) {
      toast.error('비활성화 후 삭제할 수 있습니다')
      setGroupDeleteOpen(false)
      return
    }
    await flushPendingSave()
    setGroupActionLoading(true)
    const failures: string[] = []
    await Promise.all(
      data.listings.map(async (l) => {
        try {
          const res = await fetch(`/api/sh/products/listings/${l.id}`, { method: 'DELETE' })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            failures.push(`${l.searchName}: ${err?.message ?? '삭제 실패'}`)
          }
        } catch (err) {
          failures.push(`${l.searchName}: ${err instanceof Error ? err.message : '삭제 실패'}`)
        }
      })
    )
    setGroupActionLoading(false)
    setGroupDeleteOpen(false)
    if (failures.length > 0) {
      toast.warning(`일부 삭제 실패 (${failures.length}건)`)
      await load()
    } else {
      toast.success('판매채널 상품을 삭제했습니다')
      router.push(SELLER_HUB_LISTINGS_PATH)
    }
  }

  async function goToDuplicate() {
    if (!data) return
    await flushPendingSave()
    const params = new URLSearchParams()
    params.set('duplicateFromChannelProductId', channelProductId)
    params.set('duplicateFromChannelId', data.channel.id)
    router.push(`${SELLER_HUB_LISTING_NEW_PATH}?${params.toString()}`)
  }

  function buildListingPayloadsFromGroups(ctx: ProductContext | null, groups: BuiltGroup[]) {
    return groups.map((g) => {
      // manual 모드: manualNames 우선, suffix 없음
      if (g.manualNames) {
        const fallbackBase = ctx?.displayName ?? baseSearchName.trim()
        return {
          searchName: g.manualNames.searchName || baseSearchName.trim() || fallbackBase,
          displayName:
            g.manualNames.displayName ||
            g.manualNames.searchName ||
            baseDisplayName.trim() ||
            baseSearchName.trim() ||
            fallbackBase,
          managementName: g.manualNames.managementName || undefined,
          internalCode: g.manualNames.internalCode || undefined,
          memo: memo.trim() || undefined,
          items: g.items.map((it, idx) => ({
            optionId: it.optionId,
            quantity: it.quantity,
            sortOrder: idx,
          })),
          optionSignature: g.items
            .map((it) => `${it.optionId}x${it.quantity}`)
            .sort()
            .join('|'),
        }
      }
      // bulk 모드: suffix 자동 조합
      const suffix = g.suffixParts.join(' ')
      const ctxDisplay = ctx?.displayName ?? ''
      const searchName = joinName(baseSearchName.trim() || ctxDisplay, suffix)
      const displayName = joinName(
        baseDisplayName.trim() || baseSearchName.trim() || ctxDisplay,
        suffix
      )
      const managementName = baseManagementName.trim()
        ? joinName(baseManagementName.trim(), suffix)
        : undefined
      const internalCode = baseInternalCode.trim()
        ? joinName(baseInternalCode.trim(), suffix)
        : undefined
      return {
        searchName,
        displayName,
        managementName,
        internalCode,
        memo: memo.trim() || undefined,
        items: g.items.map((it, idx) => ({
          optionId: it.optionId,
          quantity: it.quantity,
          sortOrder: idx,
        })),
        optionSignature: g.items
          .map((it) => `${it.optionId}x${it.quantity}`)
          .sort()
          .join('|'),
      }
    })
  }

  async function handleAddCommit(ctx: ProductContext | null, groups: BuiltGroup[]) {
    if (!data) return
    // bulk 모드(ctx 있음)에서 single product인 경우: 다른 상품 추가 차단
    if (ctx && data.product.kind === 'single' && ctx.id !== data.product.id) {
      toast.error('다른 상품은 이 채널 상품에 추가할 수 없습니다')
      return
    }
    await flushPendingSave()
    setMutating(true)
    const existingSignatures = new Set(
      data.listings.map((l) =>
        l.items
          .map((it) => `${it.optionId}x${it.quantity}`)
          .sort()
          .join('|')
      )
    )
    const payloads = buildListingPayloadsFromGroups(ctx, groups)

    let skipped = 0
    let created = 0
    const failures: string[] = []
    for (const p of payloads) {
      if (existingSignatures.has(p.optionSignature)) {
        skipped += 1
        continue
      }
      try {
        const res = await fetch('/api/sh/products/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: data.channel.id,
            channelProductId,
            searchName: p.searchName,
            displayName: p.displayName,
            managementName: p.managementName,
            internalCode: p.internalCode,
            memo: p.memo,
            keywords: [],
            status: 'ACTIVE',
            items: p.items,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          failures.push(`${p.searchName}: ${err?.message ?? '추가 실패'}`)
        } else {
          created += 1
        }
      } catch (err) {
        failures.push(`${p.searchName}: ${err instanceof Error ? err.message : '추가 실패'}`)
      }
    }
    setMutating(false)
    setAddBuilderOpen(false)
    if (failures.length > 0) {
      toast.warning(`${created}개 추가 · ${failures.length}개 실패 · 중복 ${skipped}개 skip`)
    } else if (skipped > 0 && created > 0) {
      toast.success(`${created}개 추가 (중복 ${skipped}개 skip)`)
    } else if (created > 0) {
      toast.success(`${created}개의 옵션이 추가되었습니다`)
    } else {
      toast.warning('추가된 옵션이 없습니다 — 모두 이미 존재하는 구성')
    }
    await load()
  }

  async function handleResetCommit(ctx: ProductContext | null, groups: BuiltGroup[]) {
    if (!data) return
    // bulk 모드(ctx 있음)에서 single product인 경우만 상품 일치 검증
    if (ctx && data.product.kind === 'single' && ctx.id !== data.product.id) {
      toast.error('다른 상품으로 재구성할 수 없습니다')
      return
    }
    await flushPendingSave()
    setMutating(true)
    const payloads = buildListingPayloadsFromGroups(ctx, groups)

    const deleteFailures: string[] = []
    await Promise.all(
      data.listings.map(async (l) => {
        try {
          const res = await fetch(`/api/sh/products/listings/${l.id}`, { method: 'DELETE' })
          if (!res.ok) deleteFailures.push(l.searchName)
        } catch {
          deleteFailures.push(l.searchName)
        }
      })
    )
    let created = 0
    const createFailures: string[] = []
    for (const p of payloads) {
      try {
        const res = await fetch('/api/sh/products/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: data.channel.id,
            channelProductId,
            searchName: p.searchName,
            displayName: p.displayName,
            managementName: p.managementName,
            internalCode: p.internalCode,
            memo: p.memo,
            keywords: [],
            status: 'ACTIVE',
            items: p.items,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          createFailures.push(`${p.searchName}: ${err?.message ?? '생성 실패'}`)
        } else {
          created += 1
        }
      } catch (err) {
        createFailures.push(`${p.searchName}: ${err instanceof Error ? err.message : '생성 실패'}`)
      }
    }
    setMutating(false)
    setResetBuilderOpen(false)
    const totalFailures = deleteFailures.length + createFailures.length
    if (totalFailures > 0) {
      toast.warning(
        `${created}개 생성 · 실패 ${totalFailures}건 (삭제 ${deleteFailures.length} / 생성 ${createFailures.length})`
      )
    } else {
      toast.success(`구성을 다시 설정했습니다 (${created}개 판매 옵션)`)
    }
    await load()
  }

  const runAutoSaveRef = useRef<() => Promise<void>>(async () => {})
  const activeSavePromiseRef = useRef<Promise<void> | null>(null)

  async function runAutoSave() {
    if (!data) return
    if (activeSavePromiseRef.current) {
      await activeSavePromiseRef.current
      return
    }
    if (!totalDirty) return

    // 필수 필드 가드: 공백이면 저장 스킵 (error chip 대신 dirty 유지)
    if (baseDirty && !baseSearchName.trim()) return

    const promise = doSave().then(() => undefined)
    activeSavePromiseRef.current = promise
    try {
      await promise
    } finally {
      activeSavePromiseRef.current = null
    }
  }

  /** 저장 성공 여부를 돌려준다 — 게이트 다이얼로그는 성공했을 때만 닫아야 한다. */
  async function doSave(changeMeta?: KeywordChangeMeta): Promise<boolean> {
    if (!data) return false
    setSaving(true)

    // 게이트 대상인데 사유가 없으면 상품명·검색어만 이번 배치에서 뺀다.
    // 가격·재고·판매상태·메모 등 나머지는 평소대로 자동 저장된다 — 게이트는 §25 가 지목한
    // 두 값에만 마찰을 만들면 되고, 무관한 편집까지 붙잡으면 그건 그냥 고장이다.
    const snapGated = gateNeeded && !changeMeta

    // 스냅샷 — 저장 도중 state가 바뀌어도 이 배치는 일관되게 적용
    const snapBaseDirty = baseDirty
    const snapKeywordsDirty = keywordsDirty
    const snapRows = rows
    const snapKeywords = keywords
    const snapBase = {
      searchName: baseSearchName,
      displayName: baseDisplayName,
      managementName: baseManagementName,
      internalCode: baseInternalCode,
      memo,
    }

    const isMixed = data.product.kind === 'mixed'

    const origById = new Map(data.listings.map((l) => [l.id, l]))
    const failures: string[] = []
    const patchedById = new Map<
      string,
      {
        searchName?: string
        displayName?: string
        managementName?: string | null
        internalCode?: string | null
        memo?: string | null
        retailPrice?: number | null
        channelStock?: number | null
        status?: 'ACTIVE' | 'SUSPENDED'
      }
    >()

    for (const l of data.listings) {
      const current = snapRows.find((r) => r.id === l.id)
      if (!current) continue
      const patch: {
        searchName?: string
        displayName?: string
        managementName?: string | null
        internalCode?: string | null
        memo?: string | null
        retailPrice?: number | null
        channelStock?: number | null
        status?: 'ACTIVE' | 'SUSPENDED'
      } = {}

      // single 모드에서만 base → listing 이름 전파.
      // listing 고유 tail(=기존 base 이후 부분)을 보존해 같은 cp 안에서도 listing별로 다른 이름 유지.
      if (!isMixed && snapBaseDirty && derivedBase) {
        const tail = (name: string | null, oldBase: string): string => {
          if (!name) return ''
          if (oldBase && name.startsWith(oldBase)) return name.slice(oldBase.length)
          // base가 매칭 안 되는 경우 attribute suffix로 회복
          const suffix = buildSuffix(
            {
              id: l.id,
              searchName: l.searchName,
              displayName: l.displayName,
              managementName: l.managementName,
              internalCode: l.internalCode,
              memo: l.memo,
              items: l.items.map((it) => ({
                optionId: it.optionId,
                attributeValues: it.attributeValues,
              })),
            },
            data.product.optionAttributes
          )
          return suffix ? ` ${suffix}` : ''
        }
        // 게이트 보류 중에는 이름을 리스팅으로 내려보내지 않는다. 여기서 새 이름이 먼저
        // 나가면 리스팅만 바뀌고 ChannelProduct 는 옛 이름으로 남아, 나중에 사유를 넣고
        // 저장할 때 서버가 계산하는 before 가 이미 어긋나 있게 된다.
        if (!snapGated) {
          const renamed = applyBaseRename(
            {
              id: l.id,
              searchName: l.searchName,
              displayName: l.displayName,
              managementName: l.managementName,
              internalCode: l.internalCode,
              memo: l.memo,
              items: l.items.map((it) => ({
                optionId: it.optionId,
                attributeValues: it.attributeValues,
              })),
            },
            data.product.optionAttributes,
            {
              baseSearchName: derivedBase.baseSearchName,
              baseDisplayName: derivedBase.baseDisplayName,
            },
            { searchName: snapBase.searchName, displayName: snapBase.displayName }
          )
          patch.searchName = renamed.searchName
          patch.displayName = renamed.displayName
        }
        patch.managementName = snapBase.managementName.trim()
          ? (
              snapBase.managementName.trim() +
              tail(l.managementName, derivedBase.baseManagementName)
            ).trim()
          : null
        patch.internalCode = snapBase.internalCode.trim()
          ? (
              snapBase.internalCode.trim() + tail(l.internalCode, derivedBase.baseInternalCode)
            ).trim()
          : null
        patch.memo = snapBase.memo.trim() || null
      }

      const orig = origById.get(l.id)!
      if (current.retailPrice !== orig.retailPrice) patch.retailPrice = current.retailPrice
      if (current.channelStock !== orig.channelStock) {
        patch.channelStock = current.channelStock
      }
      if (current.status !== orig.status) patch.status = current.status

      if (Object.keys(patch).length === 0) continue

      try {
        const res = await fetch(`/api/sh/products/listings/${l.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          failures.push(`${l.searchName}: ${err?.message ?? '저장 실패'}`)
        } else {
          patchedById.set(l.id, patch)
        }
      } catch (err) {
        failures.push(`${l.searchName}: ${err instanceof Error ? err.message : '저장 실패'}`)
      }
    }

    // base 필드·키워드 변경: channel-product에 직접 PATCH (single/mixed 모두).
    // single 모드에서도 cp.baseManagementName이 목록 표시값이라 동기화 필수.
    //
    // 기본 정보와 키워드를 **한 요청으로 합친다.** 서버는 요청 본문과 저장값을 비교해
    // 이력을 남기므로, 두 번 나눠 보내면 첫 요청은 키워드가 아직 옛 값이고 두 번째 요청은
    // 상품명이 이미 새 값이라 §26 동시 변경(multiChange)이 영영 기록되지 않는다.
    const cpBody: Record<string, unknown> = {}
    if (snapBaseDirty) {
      // 게이트 보류 중이면 상품명만 빼고 나머지 기본 정보는 그대로 저장한다.
      if (!snapGated) cpBody.baseSearchName = snapBase.searchName.trim() || undefined
      cpBody.baseDisplayName = snapBase.displayName.trim() || null
      cpBody.baseManagementName = snapBase.managementName.trim() || null
      cpBody.baseInternalCode = snapBase.internalCode.trim() || null
      cpBody.memo = snapBase.memo.trim() || null
    }
    if (snapKeywordsDirty && !snapGated) cpBody.keywords = snapKeywords

    const cpFieldCount = Object.keys(cpBody).length
    if (changeMeta) Object.assign(cpBody, changeMeta)

    let channelProductBaseSaved = false
    let keywordsSaved = false
    if (cpFieldCount > 0) {
      const label =
        snapBaseDirty && snapKeywordsDirty
          ? '기본 정보·키워드'
          : snapKeywordsDirty
            ? '키워드'
            : '기본 정보'
      try {
        const res = await fetch(`/api/sh/products/listings/channel-products/${channelProductId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cpBody),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          failures.push(`${label}: ${err?.message ?? '저장 실패'}`)
        } else {
          channelProductBaseSaved = snapBaseDirty
          keywordsSaved = snapKeywordsDirty && !snapGated
        }
      } catch (err) {
        failures.push(`${label}: ${err instanceof Error ? err.message : '저장 실패'}`)
      }
    }

    // 로컬 data 업데이트 — load() 대신 저장된 값만 반영해 in-flight 편집 보호
    if (patchedById.size > 0 || keywordsSaved || channelProductBaseSaved) {
      setData((prev) => {
        if (!prev) return prev
        // channel-product 레벨 업데이트 (keywords + mixed 모드 base 필드)
        let nextChannelProduct = prev.channelProduct
        if (keywordsSaved) {
          nextChannelProduct = { ...nextChannelProduct, keywords: snapKeywords }
        }
        if (channelProductBaseSaved) {
          nextChannelProduct = {
            ...nextChannelProduct,
            // 보류한 상품명은 로컬에도 반영하지 않는다 — 여기서 옮기면 게이트 기준선이
            // 새 값으로 올라가 사유를 받지 못한 채 게이트가 사라진다.
            ...(snapGated
              ? {}
              : {
                  baseSearchName: snapBase.searchName.trim() || nextChannelProduct.baseSearchName,
                }),
            baseDisplayName: snapBase.displayName.trim() || null,
            baseManagementName: snapBase.managementName.trim() || null,
            baseInternalCode: snapBase.internalCode.trim() || null,
            memo: snapBase.memo.trim() || null,
          }
        }
        return {
          ...prev,
          channelProduct: nextChannelProduct,
          listings: prev.listings.map((l) => {
            const p = patchedById.get(l.id)
            if (!p) return l
            return {
              ...l,
              ...(p.searchName !== undefined ? { searchName: p.searchName } : {}),
              ...(p.displayName !== undefined ? { displayName: p.displayName } : {}),
              ...(p.managementName !== undefined ? { managementName: p.managementName } : {}),
              ...(p.internalCode !== undefined ? { internalCode: p.internalCode } : {}),
              ...(p.memo !== undefined ? { memo: p.memo } : {}),
              ...(p.retailPrice !== undefined ? { retailPrice: p.retailPrice } : {}),
              ...(p.channelStock !== undefined ? { channelStock: p.channelStock } : {}),
              ...(p.status !== undefined ? { status: p.status } : {}),
              // 채널 재고는 가용 재고에 영향 없음 — status/channelStock 변경 시 품절 판정만 재계산
              ...(p.status !== undefined || p.channelStock !== undefined
                ? {
                    effectiveStatus: computeEffectiveStatus(
                      p.status ?? l.status,
                      l.availableStock,
                      p.channelStock !== undefined ? p.channelStock : l.channelStock
                    ),
                  }
                : {}),
            }
          }),
        }
      })
    }

    setSaving(false)
    if (failures.length > 0) {
      setLastError(failures.slice(0, 2).join(' · '))
      // 자동 재시도: 3회까지 backoff 후 수동 대기
      const nth = autoRetryCountRef.current
      if (nth < AUTO_RETRY_DELAYS.length) {
        const delay = AUTO_RETRY_DELAYS[nth]
        autoRetryCountRef.current = nth + 1
        setRetryCount(nth + 1)
        if (nth === 0) {
          toast.warning(`저장 실패. ${Math.round(delay / 1000)}초 후 자동 재시도합니다.`)
        }
        if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current)
        autoRetryTimerRef.current = setTimeout(() => {
          autoRetryTimerRef.current = null
          void runAutoSaveRef.current()
        }, delay)
      } else {
        // 3회 모두 실패: chip을 "저장 실패 — 재시도"로 전환하고 카운터 초기화
        autoRetryCountRef.current = 0
        setRetryCount(0)
        toast.error(
          `자동 재시도 ${AUTO_RETRY_DELAYS.length}회 모두 실패. "재시도" 버튼을 눌러주세요.`
        )
      }
    } else {
      setLastError(null)
      autoRetryCountRef.current = 0
      setRetryCount(0)
      if (autoRetryTimerRef.current) {
        clearTimeout(autoRetryTimerRef.current)
        autoRetryTimerRef.current = null
      }
    }
    return failures.length === 0
  }

  runAutoSaveRef.current = runAutoSave

  /** 게이트 확인 → 사유를 실어 한 번 더 저장한다. 대기 중인 자동 저장은 먼저 정리한다. */
  async function confirmGatedSave(meta: KeywordChangeMeta) {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (activeSavePromiseRef.current) await activeSavePromiseRef.current
    const promise = doSave(meta)
    activeSavePromiseRef.current = promise.then(() => undefined)
    let ok = false
    try {
      ok = await promise
    } finally {
      activeSavePromiseRef.current = null
    }
    if (ok) {
      setGateOpen(false)
      setHistoryKey((k) => k + 1)
    }
  }

  function scheduleAutoSave(delay: number) {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }
    // 새 사용자 편집이 들어왔으므로 대기 중인 backoff 재시도는 폐기하고
    // 재시도 카운터도 리셋 — 새 저장으로 성공 가능성이 있음
    if (autoRetryTimerRef.current) {
      clearTimeout(autoRetryTimerRef.current)
      autoRetryTimerRef.current = null
    }
    autoRetryCountRef.current = 0
    setRetryCount(0)
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null
      void runAutoSaveRef.current()
    }, delay)
  }

  async function flushPendingSave() {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    // 이미 진행 중인 저장이 있으면 먼저 끝날 때까지 대기
    if (activeSavePromiseRef.current) {
      await activeSavePromiseRef.current
    }
    // 아직 dirty가 남아있으면 한 번 더 flush
    if (totalDirty) {
      await runAutoSaveRef.current()
    }
  }

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
      if (autoRetryTimerRef.current) {
        clearTimeout(autoRetryTimerRef.current)
      }
    }
  }, [])

  // pending save 가 있는 상태에서 페이지 이탈 방지
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (totalDirty || saving) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [totalDirty, saving])

  if (loading && !data) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">그룹 정보를 불러올 수 없습니다.</p>
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-4 z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <Link
          href={SELLER_HUB_LISTINGS_PATH}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          목록으로
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <SaveStatusChip
            saving={saving}
            dirty={totalDirty}
            dirtyCount={dirtyCount}
            error={lastError}
            retryCount={retryCount}
            onRetry={() => {
              setLastError(null)
              autoRetryCountRef.current = 0
              setRetryCount(0)
              if (autoRetryTimerRef.current) {
                clearTimeout(autoRetryTimerRef.current)
                autoRetryTimerRef.current = null
              }
              void runAutoSave()
            }}
          />
          {/* 게이트 보류 중에는 상품명·검색어가 자동 저장되지 않는다.
              저장 칩만으로는 "곧 저장됨"과 구분되지 않으므로 버튼이 직접 알린다. */}
          {gateNeeded && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/50 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              상품명·검색어는 사유 입력 후 저장됩니다
            </span>
          )}
          <Button
            size="sm"
            onClick={async () => {
              setLastError(null)
              autoRetryCountRef.current = 0
              setRetryCount(0)
              if (autoRetryTimerRef.current) {
                clearTimeout(autoRetryTimerRef.current)
                autoRetryTimerRef.current = null
              }
              if (gateNeeded) {
                setGateOpen(true)
                return
              }
              await flushPendingSave()
            }}
            disabled={(!totalDirty && !gateNeeded) || saving || mutating || groupActionLoading}
          >
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {gateNeeded ? '변경 사유 입력' : '저장'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setGroupSuspendOpen(true)}
            disabled={mutating || groupActionLoading || data.listings.length === 0}
          >
            {allSuspended ? (
              <>
                <Play className="mr-1 h-4 w-4" />
                활성화
              </>
            ) : (
              <>
                <Pause className="mr-1 h-4 w-4" />
                비활성화
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goToDuplicate}
            disabled={mutating || groupActionLoading || data.listings.length === 0}
          >
            <Copy className="mr-1 h-4 w-4" />
            복제
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setGroupDeleteOpen(true)}
            disabled={mutating || groupActionLoading || data.listings.length === 0 || !allSuspended}
            title={!allSuspended ? '비활성화 후 삭제할 수 있습니다' : undefined}
          >
            <Trash2 className="mr-1 h-4 w-4" />
            삭제
          </Button>
        </div>
      </div>

      <div>
        <p className="text-xs text-muted-foreground">{data.channel.name} · 판매채널 상품 상세</p>
        <h1 className="text-2xl font-bold">
          {baseManagementName.trim() || baseSearchName.trim() || '판매채널 상품'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.product.kind === 'mixed' ? (
            <>
              혼합 구성: {data.product.products.map((p) => p.name).join(', ')}
              <span className="ml-1 text-xs">({data.product.products.length}개 상품)</span>
            </>
          ) : (
            <>
              기준 상품: {data.product.displayName}
              {data.product.brand && ` · ${data.product.brand.name}`}
            </>
          )}
        </p>
      </div>

      <GroupBaseInfoCard
        channelName={data.channel.name}
        rules={rules}
        baseSearchName={baseSearchName}
        baseDisplayName={baseDisplayName}
        baseManagementName={baseManagementName}
        baseInternalCode={baseInternalCode}
        memo={memo}
        inconsistentBases={derivedBase?.inconsistentBases ?? []}
        onBaseSearchNameChange={(v) => handleBaseChange('searchName', v)}
        onBaseDisplayNameChange={(v) => handleBaseChange('displayName', v)}
        onBaseManagementNameChange={(v) => handleBaseChange('managementName', v)}
        onBaseInternalCodeChange={(v) => handleBaseChange('internalCode', v)}
        onMemoChange={(v) => handleBaseChange('memo', v)}
        disabled={mutating}
        namesReadOnly={readOnly}
        aiNameButton={
          readOnly
            ? undefined
            : {
                disabled: !productId,
                tooltip: !productId ? '혼합 구성에서는 사용할 수 없습니다' : undefined,
                onClick: () => {
                  draft.load({ keywords, searchName: baseSearchName })
                  setNameDraftOpen(true)
                },
              }
        }
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-1.5 text-lg">
              키워드 (상품 단위)
              {readOnly && <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
            </CardTitle>
            <CardDescription>
              {data.channel.name} 상의 이 상품에 공통 적용되는 검색 키워드입니다. 최대 30개.
              {readOnly && ' 연동 채널이라 이 화면에서 수정할 수 없습니다.'}
            </CardDescription>
          </div>
          <CardAction className="flex items-center gap-1.5">
            {readOnly && <Badge variant="outline">연동 채널 (읽기전용)</Badge>}
            {!readOnly && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!productId}
                        onClick={() => {
                          draft.load({ keywords, searchName: baseSearchName })
                          setKeywordDraftOpen(true)
                        }}
                      >
                        <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" />
                        AI 키워드
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!productId && (
                    <TooltipContent side="top">혼합 구성에서는 사용할 수 없습니다</TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyKeywords}
              disabled={keywords.every((keyword: string) => keyword.trim().length === 0)}
            >
              <Copy className="mr-1 h-4 w-4" aria-hidden="true" />
              키워드 복사
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <KeywordEditor
            value={keywords}
            onChange={handleKeywordsChange}
            suggestions={readOnly ? undefined : keywordSuggestions}
            productName={baseSearchName}
            optionNames={optionNames}
            rules={rules}
            readOnly={readOnly}
          />
          {/* 채널상품 그룹은 리스팅이 여럿이라 귀속 상품을 하나로 특정할 수 없다.
              링크 없이 키워드만 마스터로 올린다(연결은 키워드 관리에서 붙인다). */}
          <div className="flex justify-end">
            <RegisterKeywordsButton keywords={keywords} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-lg">옵션 구성 ({rows.length}개)</CardTitle>
            <CardDescription>
              체크박스로 여러 옵션을 선택하면 재고·판매가·판매상태를 한 번에 바꿀 수 있습니다.
              변경은 자동으로 저장됩니다. 소비자가는 상품의 옵션 소비자가에서 자동 계산됩니다.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await flushPendingSave()
                setAddBuilderOpen(true)
              }}
              // 게이트 보류 중 차단. 두 버튼은 편집 중인 baseSearchName 으로 리스팅을 새로
              // 만들기 때문에, 열어두면 사유 없이 새 이름이 리스팅에 실려 나가고 ChannelProduct
              // 만 옛 이름으로 남는다(= 게이트 우회).
              disabled={mutating || gateNeeded}
              title={gateNeeded ? GATE_BLOCK_HINT : undefined}
            >
              <Plus className="mr-1 h-4 w-4" />
              옵션 추가
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await flushPendingSave()
                setResetConfirmOpen(true)
              }}
              disabled={mutating || gateNeeded}
              title={gateNeeded ? GATE_BLOCK_HINT : undefined}
            >
              <Layers className="mr-1 h-4 w-4" />
              구성 다시 설정
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {selected.size > 0 && (
            <GroupBulkEditBar
              selectedCount={selected.size}
              onClear={() => setSelected(new Set())}
              onApply={async (patch) => applyBulkPatch(patch)}
              onRequestDelete={requestDeleteSelected}
              loading={mutating}
            />
          )}
          <GroupListingsTable
            rows={rows}
            selected={selected}
            onSelectedChange={setSelected}
            onRowChange={handleRowChange}
            onDeleteRequest={requestDeleteOne}
            dirtyIds={dirtyRowIds}
            disabled={mutating}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">가격 시뮬레이션 내역</CardTitle>
          <CardDescription>
            이 판매채널 상품과 {data.channel.name} 채널에 함께 연결된 가격 시뮬레이션입니다.
            최신순으로 표시됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PricingScenarioHistoryPanel
            channelProductId={channelProductId}
            onRowClick={(id) => router.push(getSellerHubPricingScenarioPath(id))}
            emptyMessage="이 판매채널 상품과 채널에 대한 가격 시뮬레이션 내역이 없습니다."
          />
        </CardContent>
      </Card>

      {/* 변경 이력 (§26).
          채널 상품 저장은 서버가 listingId 없이 productId 로만 이력을 남기므로 상품 기준으로 읽는다.
          혼합 구성은 서버가 귀속 상품을 특정하지 못해(productId=null) 어떤 키로도 조회되지 않는다. */}
      <KeywordChangeTimeline
        productId={data.product.kind === 'single' ? data.product.id : null}
        crossChannelNotice={data.product.kind === 'single'}
        unavailableReason={
          data.product.kind === 'single'
            ? null
            : '혼합 구성 판매채널 상품은 귀속 상품을 특정할 수 없어 이력을 이 화면에서 조회할 수 없습니다. 변경 기록 자체는 정상적으로 저장됩니다.'
        }
        refreshKey={historyKey}
      />

      <KeywordChangeDialog
        open={gateOpen}
        onOpenChange={setGateOpen}
        beforeName={data.channelProduct.baseSearchName}
        afterName={nameToSave}
        beforeKeywords={data.channelProduct.keywords}
        afterKeywords={keywordsToSave}
        saving={saving}
        onConfirm={confirmGatedSave}
      />

      {/* AI 초안 다이얼로그 2종 — useNameDraft 훅 하나를 공유한다(화면 방문당 API 호출 1회).
          연동 채널·mixed 상품에서는 버튼 자체를 안 보이거나 잠그므로 여기 open 은 항상 false 로
          유지된다. 상품명 적용은 handleBaseChange 를 거쳐야 자동저장 타이머가 걸린다
          (setBaseSearchName 직접 호출 금지). */}
      <NameDraftDialog
        open={nameDraftOpen}
        onOpenChange={setNameDraftOpen}
        mode="name"
        status={draft.status}
        names={draft.names}
        keywords={draft.keywords}
        reviews={draft.reviews}
        existingKeywords={keywords}
        currentSearchName={baseSearchName}
        onApplyName={(v) => handleBaseChange('searchName', v)}
        onAddKeyword={handleAddKeywordFromDraft}
        onRemoveKeyword={handleRemoveKeywordFromDraft}
      />
      <NameDraftDialog
        open={keywordDraftOpen}
        onOpenChange={setKeywordDraftOpen}
        mode="keyword"
        status={draft.status}
        names={draft.names}
        keywords={draft.keywords}
        reviews={draft.reviews}
        existingKeywords={keywords}
        currentSearchName={baseSearchName}
        onApplyName={(v) => handleBaseChange('searchName', v)}
        onAddKeyword={handleAddKeywordFromDraft}
        onRemoveKeyword={handleRemoveKeywordFromDraft}
      />

      {/* 삭제 확인 다이얼로그 */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(v) => {
          if (!v && !deleting) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>판매채널 상품 삭제</DialogTitle>
            <DialogDescription>
              <span className="font-medium">{deleteTarget?.label}</span>을(를) 삭제하시겠습니까?
              <br />이 판매 옵션과 매칭된 배송 별칭도 함께 삭제됩니다. 이미 매칭된 배송 주문은 해당
              옵션 연결만 해제됩니다 (이력 보존). 이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              취소
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 그룹 일괄 비활성화/활성화 확인 */}
      <Dialog
        open={groupSuspendOpen}
        onOpenChange={(v) => {
          if (!groupActionLoading) setGroupSuspendOpen(v)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>판매채널 상품 {allSuspended ? '활성화' : '비활성화'}</DialogTitle>
            <DialogDescription>
              {data.channel.name}의 이 상품에 속한{' '}
              <span className="font-medium">{data.listings.length}개</span> 판매 옵션의 판매상태를
              일괄{' '}
              <span className="font-medium">
                {allSuspended ? '판매중(ACTIVE)' : '판매중지(SUSPENDED)'}
              </span>
              로 변경합니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGroupSuspendOpen(false)}
              disabled={groupActionLoading}
            >
              취소
            </Button>
            <Button onClick={confirmGroupSuspendToggle} disabled={groupActionLoading}>
              {groupActionLoading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {allSuspended ? '활성화' : '비활성화'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 그룹 전체 삭제 확인 */}
      <Dialog
        open={groupDeleteOpen}
        onOpenChange={(v) => {
          if (!groupActionLoading) setGroupDeleteOpen(v)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>판매채널 상품 삭제</DialogTitle>
            <DialogDescription>
              {data.channel.name}의 이 상품에 속한{' '}
              <span className="font-medium">{data.listings.length}개</span> 판매 옵션을 모두
              삭제합니다.
              <br />• 매칭된 배송 별칭(alias)도 함께 삭제됩니다.
              <br />• 이미 매칭된 배송 주문은 해당 옵션 연결만 해제됩니다 (이력 보존).
              <br />이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGroupDeleteOpen(false)}
              disabled={groupActionLoading}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={confirmGroupDelete}
              disabled={groupActionLoading}
            >
              {groupActionLoading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 옵션 추가: CompositionBuilder Dialog */}
      <Dialog
        open={addBuilderOpen}
        onOpenChange={(v) => {
          if (!mutating) setAddBuilderOpen(v)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>옵션 추가</DialogTitle>
            <DialogDescription>
              현재 채널 상품에 새 옵션 구성을 추가합니다. 이미 존재하는 동일 구성은 건너뜁니다.
            </DialogDescription>
          </DialogHeader>
          <CompositionBuilder
            onCommit={handleAddCommit}
            disabled={mutating}
            initialMode={data.product.kind === 'mixed' ? 'manual' : 'bulk'}
          />
        </DialogContent>
      </Dialog>

      {/* 구성 다시 설정: 1차 확인 */}
      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>구성 다시 설정</DialogTitle>
            <DialogDescription>
              이 채널 상품의 기존 판매 옵션 <span className="font-medium">{rows.length}개</span>를
              삭제하고 처음부터 다시 구성합니다.
              <br />• 각 판매 옵션의 판매가·판매상태는 사라집니다.
              <br />• 이 판매 옵션으로 매칭된 배송 별칭(alias)은 함께 삭제됩니다.
              <br />• 이미 매칭된 배송 주문은 해당 옵션 연결만 해제됩니다 (이력 보존).
              <br />이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetConfirmOpen(false)}>
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setResetConfirmOpen(false)
                setResetBuilderOpen(true)
              }}
            >
              계속
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 구성 다시 설정: CompositionBuilder Dialog */}
      <Dialog
        open={resetBuilderOpen}
        onOpenChange={(v) => {
          if (!mutating) setResetBuilderOpen(v)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>구성 다시 설정</DialogTitle>
            <DialogDescription>
              기존 판매 옵션을 모두 삭제하고 새 구성을 생성합니다. 기본 정보(상품명·관리
              코드·메모)는 유지됩니다.
            </DialogDescription>
          </DialogHeader>
          <CompositionBuilder
            onCommit={handleResetCommit}
            disabled={mutating}
            initialMode={data.product.kind === 'mixed' ? 'manual' : 'bulk'}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
