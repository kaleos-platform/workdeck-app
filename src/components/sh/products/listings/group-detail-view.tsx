'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

  // 편집 state
  const [keywords, setKeywords] = useState<string[]>([])
  const [rows, setRows] = useState<GroupListingFull[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // 기본 정보 편집 state
  const [baseSearchName, setBaseSearchName] = useState('')
  const [baseDisplayName, setBaseDisplayName] = useState('')
  const [baseInternalCode, setBaseInternalCode] = useState('')
  const [memo, setMemo] = useState('')

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
    toast.success(`${selected.size}개 listing의 값이 변경되었습니다 (저장 버튼으로 반영)`)
  }

  async function handleSaveAll() {
    if (!data || !totalDirty) return
    setSaving(true)
    const origById = new Map(data.listings.map((l) => [l.id, l]))
    const failures: string[] = []
    let updatedCount = 0

    for (const l of data.listings) {
      const current = rows.find((r) => r.id === l.id)
      if (!current) continue
      const patch: {
        searchName?: string
        displayName?: string
        internalCode?: string | null
        memo?: string | null
        retailPrice?: number | null
        status?: 'ACTIVE' | 'SUSPENDED'
      } = {}

      if (baseDirty) {
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
        patch.searchName = joinName(baseSearchName.trim(), suffix) || l.searchName
        patch.displayName = joinName(baseDisplayName.trim(), suffix) || l.displayName
        patch.internalCode = baseInternalCode.trim()
          ? joinName(baseInternalCode.trim(), suffix)
          : null
        patch.memo = memo.trim() || null
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
          updatedCount += 1
        }
      } catch (err) {
        failures.push(`${l.searchName}: ${err instanceof Error ? err.message : '저장 실패'}`)
      }
    }

    if (keywordsDirty) {
      try {
        const res = await fetch(`/api/sh/products/listings/groups/${productId}/${channelId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keywords }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          failures.push(`키워드: ${err?.message ?? '저장 실패'}`)
        }
      } catch (err) {
        failures.push(`키워드: ${err instanceof Error ? err.message : '저장 실패'}`)
      }
    }

    setSaving(false)
    if (failures.length > 0) {
      toast.warning(`일부 저장 실패 (${failures.length}건). ${failures.slice(0, 2).join(' / ')}`)
    } else {
      toast.success(
        updatedCount > 0 || keywordsDirty ? '변경사항이 저장되었습니다' : '변경사항이 없습니다'
      )
    }
    await load()
  }

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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading || saving}>
            <RefreshCw className="mr-1 h-4 w-4" />
            새로고침
          </Button>
          <Button size="sm" onClick={handleSaveAll} disabled={!totalDirty || saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {totalDirty ? `저장 (${dirtyCount}건 변경)` : '저장'}
          </Button>
        </div>
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
        onBaseSearchNameChange={setBaseSearchName}
        onBaseDisplayNameChange={setBaseDisplayName}
        onBaseInternalCodeChange={setBaseInternalCode}
        onMemoChange={setMemo}
        disabled={saving}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">키워드 (상품 단위)</CardTitle>
          <CardDescription>
            {data.channel.name} 상의 이 상품에 공통 적용되는 검색 키워드입니다. 최대 30개.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KeywordEditor value={keywords} onChange={setKeywords} suggestions={keywordSuggestions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">옵션 구성 ({rows.length}개)</CardTitle>
          <CardDescription>
            체크박스로 여러 옵션을 선택하면 판매가·판매상태를 한 번에 바꿀 수 있습니다. 모든 변경은
            상단의 &lsquo;저장&rsquo; 버튼을 눌러야 반영됩니다. 소비자가는 상품의 옵션 소비자가에서
            자동 계산됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {selected.size > 0 && (
            <GroupBulkEditBar
              selectedCount={selected.size}
              onClear={() => setSelected(new Set())}
              onApply={async (patch) => applyBulkPatch(patch)}
            />
          )}
          <GroupListingsTable
            rows={rows}
            selected={selected}
            onSelectedChange={setSelected}
            onRowChange={handleRowChange}
            dirtyIds={dirtyRowIds}
            disabled={saving}
          />
        </CardContent>
      </Card>
    </div>
  )
}
