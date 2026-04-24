'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, Check, Layers, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SELLER_HUB_LISTINGS_PATH } from '@/lib/deck-routes'

import { KeywordEditor } from './keyword-editor'
import { GroupListingsTable, type GroupListingRow } from './group-listings-table'
import { GroupBulkEditBar, type BulkPatch } from './group-bulk-edit-bar'
import {
  GroupBaseInfoCard,
  type OptionAttribute,
  buildSuffix,
  deriveBaseValues,
  joinName,
} from './group-base-info-card'
import { CompositionBuilder, type BuiltGroup, type ProductContext } from './composition-builder'

type GroupListingFull = GroupListingRow & {
  memo: string | null
}

type GroupDetail = {
  product: {
    id: string
    name: string
    internalName: string | null
    displayName: string
    brand: { id: string; name: string } | null
    optionAttributes: OptionAttribute[]
  }
  channel: { id: string; name: string; kind: string }
  meta: { keywords: string[] }
  listings: GroupListingFull[]
}

type Props = {
  productId: string
  channelId: string
}

export function GroupDetailView({ productId, channelId }: Props) {
  const [data, setData] = useState<GroupDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 편집 state
  const [keywords, setKeywords] = useState<string[]>([])
  const [rows, setRows] = useState<GroupListingFull[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // 기본 정보 편집 state
  const [baseSearchName, setBaseSearchName] = useState('')
  const [baseDisplayName, setBaseDisplayName] = useState('')
  const [baseInternalCode, setBaseInternalCode] = useState('')
  const [memo, setMemo] = useState('')

  // 옵션 CRUD state
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; label: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [addBuilderOpen, setAddBuilderOpen] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resetBuilderOpen, setResetBuilderOpen] = useState(false)
  const [mutating, setMutating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/products/listings/groups/${productId}/${channelId}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('그룹 조회 실패')
      const d: GroupDetail = await res.json()
      setData(d)
      setKeywords(d.meta.keywords ?? [])
      setRows(d.listings)
      setSelected(new Set())
      const derived = deriveBaseValues(
        d.listings.map((l) => ({
          id: l.id,
          searchName: l.searchName,
          displayName: l.displayName,
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
      setBaseInternalCode(derived.baseInternalCode)
      setMemo(derived.memo)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '그룹 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [productId, channelId])

  useEffect(() => {
    load()
  }, [load])

  const keywordSuggestions = useMemo(() => {
    if (!data) return []
    const set = new Set<string>([data.product.displayName])
    if (data.product.brand) set.add(data.product.brand.name)
    for (const l of data.listings) {
      for (const it of l.items) set.add(it.optionName)
    }
    return Array.from(set)
  }, [data])

  const derivedBase = useMemo(() => {
    if (!data) return null
    return deriveBaseValues(
      data.listings.map((l) => ({
        id: l.id,
        searchName: l.searchName,
        displayName: l.displayName,
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
    if (!derivedBase) return false
    return (
      baseSearchName !== derivedBase.baseSearchName ||
      baseDisplayName !== derivedBase.baseDisplayName ||
      baseInternalCode !== derivedBase.baseInternalCode ||
      memo !== derivedBase.memo
    )
  }, [derivedBase, baseSearchName, baseDisplayName, baseInternalCode, memo])

  const keywordsDirty = useMemo(() => {
    const original = data?.meta.keywords ?? []
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
      if (r.retailPrice !== o.retailPrice || r.status !== o.status) set.add(r.id)
    }
    return set
  }, [rows, data])

  const totalDirty = baseDirty || keywordsDirty || dirtyRowIds.size > 0
  const dirtyCount = (baseDirty ? 1 : 0) + (keywordsDirty ? 1 : 0) + dirtyRowIds.size

  function handleRowChange(id: string, patch: BulkPatch) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        const next = { ...r }
        if (patch.retailPrice !== undefined) next.retailPrice = patch.retailPrice
        if (patch.status !== undefined) next.status = patch.status
        return next
      })
    )
    // Select(판매상태)는 즉시, 텍스트(판매가)는 800ms debounce
    scheduleAutoSave(patch.status !== undefined ? 0 : 800)
  }

  function applyBulkPatch(patch: BulkPatch) {
    if (selected.size === 0) return
    setRows((prev) =>
      prev.map((r) => {
        if (!selected.has(r.id)) return r
        const next = { ...r }
        if (patch.retailPrice !== undefined) next.retailPrice = patch.retailPrice
        if (patch.status !== undefined) next.status = patch.status
        return next
      })
    )
    toast.success(`${selected.size}개 listing에 적용했습니다`)
    scheduleAutoSave(0)
  }

  function handleKeywordsChange(next: string[]) {
    setKeywords(next)
    scheduleAutoSave(0)
  }

  function handleBaseChange(
    field: 'searchName' | 'displayName' | 'internalCode' | 'memo',
    value: string
  ) {
    if (field === 'searchName') setBaseSearchName(value)
    else if (field === 'displayName') setBaseDisplayName(value)
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
    const label = ids.length === 1 && first ? first.searchName : `${ids.length}개 listing`
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
      toast.success(`${deleteTarget.ids.length}개 listing이 삭제되었습니다`)
    }
    await load()
  }

  function buildListingPayloadsFromGroups(ctx: ProductContext, groups: BuiltGroup[]) {
    return groups.map((g) => {
      const suffix = g.suffixParts.join(' ')
      const searchName = joinName(baseSearchName.trim() || ctx.displayName, suffix)
      const displayName = joinName(baseDisplayName.trim() || ctx.displayName, suffix)
      const internalCode = baseInternalCode.trim()
        ? joinName(baseInternalCode.trim(), suffix)
        : undefined
      return {
        searchName,
        displayName,
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

  async function handleAddCommit(ctx: ProductContext, groups: BuiltGroup[]) {
    if (!data) return
    if (ctx.id !== productId) {
      toast.error('다른 상품은 이 그룹에 추가할 수 없습니다')
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
            channelId,
            searchName: p.searchName,
            displayName: p.displayName,
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

  async function handleResetCommit(ctx: ProductContext, groups: BuiltGroup[]) {
    if (!data) return
    if (ctx.id !== productId) {
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
            channelId,
            searchName: p.searchName,
            displayName: p.displayName,
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
      toast.success(`구성을 다시 설정했습니다 (${created}개 listing)`)
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
    if (baseDirty && (!baseSearchName.trim() || !baseDisplayName.trim())) return

    const promise = doSave()
    activeSavePromiseRef.current = promise
    try {
      await promise
    } finally {
      activeSavePromiseRef.current = null
    }
  }

  async function doSave() {
    if (!data) return
    setSaving(true)

    // 스냅샷 — 저장 도중 state가 바뀌어도 이 배치는 일관되게 적용
    const snapBaseDirty = baseDirty
    const snapKeywordsDirty = keywordsDirty
    const snapRows = rows
    const snapKeywords = keywords
    const snapBase = {
      searchName: baseSearchName,
      displayName: baseDisplayName,
      internalCode: baseInternalCode,
      memo,
    }

    const origById = new Map(data.listings.map((l) => [l.id, l]))
    const failures: string[] = []
    const patchedById = new Map<
      string,
      {
        searchName?: string
        displayName?: string
        internalCode?: string | null
        memo?: string | null
        retailPrice?: number | null
        status?: 'ACTIVE' | 'SUSPENDED'
      }
    >()

    for (const l of data.listings) {
      const current = snapRows.find((r) => r.id === l.id)
      if (!current) continue
      const patch: {
        searchName?: string
        displayName?: string
        internalCode?: string | null
        memo?: string | null
        retailPrice?: number | null
        status?: 'ACTIVE' | 'SUSPENDED'
      } = {}

      if (snapBaseDirty) {
        const suffix = buildSuffix(
          {
            id: l.id,
            searchName: l.searchName,
            displayName: l.displayName,
            internalCode: l.internalCode,
            memo: l.memo,
            items: l.items.map((it) => ({
              optionId: it.optionId,
              attributeValues: it.attributeValues,
            })),
          },
          data.product.optionAttributes
        )
        patch.searchName = joinName(snapBase.searchName.trim(), suffix) || l.searchName
        patch.displayName = joinName(snapBase.displayName.trim(), suffix) || l.displayName
        patch.internalCode = snapBase.internalCode.trim()
          ? joinName(snapBase.internalCode.trim(), suffix)
          : null
        patch.memo = snapBase.memo.trim() || null
      }

      const orig = origById.get(l.id)!
      if (current.retailPrice !== orig.retailPrice) patch.retailPrice = current.retailPrice
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

    let keywordsSaved = false
    if (snapKeywordsDirty) {
      try {
        const res = await fetch(`/api/sh/products/listings/groups/${productId}/${channelId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keywords: snapKeywords }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          failures.push(`키워드: ${err?.message ?? '저장 실패'}`)
        } else {
          keywordsSaved = true
        }
      } catch (err) {
        failures.push(`키워드: ${err instanceof Error ? err.message : '저장 실패'}`)
      }
    }

    // 로컬 data 업데이트 — load() 대신 저장된 값만 반영해 in-flight 편집 보호
    if (patchedById.size > 0 || keywordsSaved) {
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          meta: keywordsSaved ? { ...prev.meta, keywords: snapKeywords } : prev.meta,
          listings: prev.listings.map((l) => {
            const p = patchedById.get(l.id)
            if (!p) return l
            return {
              ...l,
              ...(p.searchName !== undefined ? { searchName: p.searchName } : {}),
              ...(p.displayName !== undefined ? { displayName: p.displayName } : {}),
              ...(p.internalCode !== undefined ? { internalCode: p.internalCode } : {}),
              ...(p.memo !== undefined ? { memo: p.memo } : {}),
              ...(p.retailPrice !== undefined ? { retailPrice: p.retailPrice } : {}),
              ...(p.status !== undefined ? { status: p.status } : {}),
            }
          }),
        }
      })
    }

    setSaving(false)
    if (failures.length > 0) {
      setLastError(failures.slice(0, 2).join(' · '))
      toast.warning(`일부 저장 실패 (${failures.length}건). ${failures.slice(0, 2).join(' / ')}`)
    } else {
      setLastError(null)
    }
  }

  runAutoSaveRef.current = runAutoSave

  function scheduleAutoSave(delay: number) {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }
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
      <div className="flex items-center justify-between gap-3">
        <Link
          href={SELLER_HUB_LISTINGS_PATH}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          목록으로
        </Link>
        <SaveStatusChip
          saving={saving}
          dirty={totalDirty}
          dirtyCount={dirtyCount}
          error={lastError}
          onRetry={() => {
            setLastError(null)
            void runAutoSave()
          }}
        />
      </div>

      <div>
        <p className="text-xs text-muted-foreground">
          {data.channel.name} · 판매채널 상품 (상품 단위)
        </p>
        <h1 className="text-2xl font-bold">{data.product.displayName}</h1>
        {data.product.brand && (
          <p className="mt-1 text-sm text-muted-foreground">{data.product.brand.name}</p>
        )}
      </div>

      <GroupBaseInfoCard
        channelName={data.channel.name}
        baseSearchName={baseSearchName}
        baseDisplayName={baseDisplayName}
        baseInternalCode={baseInternalCode}
        memo={memo}
        inconsistentBases={derivedBase?.inconsistentBases ?? []}
        onBaseSearchNameChange={(v) => handleBaseChange('searchName', v)}
        onBaseDisplayNameChange={(v) => handleBaseChange('displayName', v)}
        onBaseInternalCodeChange={(v) => handleBaseChange('internalCode', v)}
        onMemoChange={(v) => handleBaseChange('memo', v)}
        disabled={mutating}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">키워드 (상품 단위)</CardTitle>
          <CardDescription>
            {data.channel.name} 상의 이 상품에 공통 적용되는 검색 키워드입니다. 최대 30개.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KeywordEditor
            value={keywords}
            onChange={handleKeywordsChange}
            suggestions={keywordSuggestions}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-lg">옵션 구성 ({rows.length}개)</CardTitle>
            <CardDescription>
              체크박스로 여러 옵션을 선택하면 판매가·판매상태를 한 번에 바꿀 수 있습니다. 변경은
              자동으로 저장됩니다. 소비자가는 상품의 옵션 소비자가에서 자동 계산됩니다.
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
              disabled={mutating}
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
              disabled={mutating}
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
              <br />이 listing과 매칭된 배송 별칭도 함께 삭제됩니다. 이미 매칭된 배송 주문은
              listing=null로 유지됩니다 (이력 보존). 이 작업은 되돌릴 수 없습니다.
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
              현재 그룹에 새 옵션 구성을 추가합니다. 이미 존재하는 동일 구성은 건너뜁니다.
            </DialogDescription>
          </DialogHeader>
          <CompositionBuilder onCommit={handleAddCommit} disabled={mutating} />
        </DialogContent>
      </Dialog>

      {/* 구성 다시 설정: 1차 확인 */}
      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>구성 다시 설정</DialogTitle>
            <DialogDescription>
              이 그룹의 기존 판매채널 상품 <span className="font-medium">{rows.length}개</span>를
              삭제하고 처음부터 다시 구성합니다.
              <br />• 각 listing의 판매가·판매상태는 사라집니다.
              <br />• 이 listing으로 매칭된 배송 별칭(alias)은 함께 삭제됩니다.
              <br />• 이미 매칭된 배송 주문은 listing=null로 유지됩니다 (이력 보존).
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
              기존 listing을 모두 삭제하고 새 구성을 생성합니다. 기본 정보(상품명·관리 코드·메모)는
              유지됩니다.
            </DialogDescription>
          </DialogHeader>
          <CompositionBuilder onCommit={handleResetCommit} disabled={mutating} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SaveStatusChip({
  saving,
  dirty,
  dirtyCount,
  error,
  onRetry,
}: {
  saving: boolean
  dirty: boolean
  dirtyCount: number
  error: string | null
  onRetry: () => void
}) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        저장 중...
      </span>
    )
  }
  if (error) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="h-8 gap-1 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        title={error}
      >
        <AlertCircle className="h-3.5 w-3.5" />
        저장 실패 — 재시도
      </Button>
    )
  }
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-600">
        <Loader2 className="h-3.5 w-3.5 animate-spin opacity-50" />
        저장 대기 중... ({dirtyCount}건)
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Check className="h-3.5 w-3.5 text-emerald-600" />
      저장됨
    </span>
  )
}
