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

type GroupDetail = {
  product: {
    id: string
    name: string
    internalName: string | null
    displayName: string
    brand: { id: string; name: string } | null
  }
  channel: { id: string; name: string; kind: string }
  meta: { keywords: string[] }
  listings: GroupListingRow[]
}

type Props = {
  productId: string
  channelId: string
}

export function GroupDetailView({ productId, channelId }: Props) {
  const [data, setData] = useState<GroupDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [keywords, setKeywords] = useState<string[]>([])
  const [rows, setRows] = useState<GroupListingRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [savingKeywords, setSavingKeywords] = useState(false)
  const [savingRow, setSavingRow] = useState<string | null>(null)
  const [bulkApplying, setBulkApplying] = useState(false)

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

  async function handleKeywordsSave() {
    setSavingKeywords(true)
    try {
      const res = await fetch(`/api/sh/products/listings/groups/${productId}/${channelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '저장 실패')
      }
      toast.success('키워드가 저장되었습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSavingKeywords(false)
    }
  }

  async function handleRowSave(
    id: string,
    patch: { retailPrice?: number | null; status?: 'ACTIVE' | 'SUSPENDED' }
  ) {
    setSavingRow(id)
    try {
      const res = await fetch(`/api/sh/products/listings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '저장 실패')
      }
      toast.success('변경사항이 저장되었습니다')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSavingRow(null)
    }
  }

  async function handleBulkApply(patch: BulkPatch) {
    if (selected.size === 0) return
    setBulkApplying(true)
    try {
      const body: { ids: string[]; patch: BulkPatch } = {
        ids: Array.from(selected),
        patch,
      }
      const res = await fetch('/api/sh/products/listings/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '일괄 수정 실패')
      }
      const result: { updated: number } = await res.json()
      toast.success(`${result.updated}개 listing이 일괄 수정되었습니다`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일괄 수정 실패')
    } finally {
      setBulkApplying(false)
    }
  }

  if (loading && !data) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">그룹 정보를 불러올 수 없습니다.</p>
  }

  const keywordsDirty =
    keywords.length !== (data.meta.keywords?.length ?? 0) ||
    keywords.some((k, i) => k !== data.meta.keywords?.[i])

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
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className="mr-1 h-4 w-4" />
          새로고침
        </Button>
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

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-lg">키워드 (상품 단위)</CardTitle>
            <CardDescription>
              {data.channel.name} 상의 이 상품에 공통 적용되는 검색 키워드입니다. 최대 30개.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={handleKeywordsSave}
            disabled={!keywordsDirty || savingKeywords}
          >
            {savingKeywords && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            키워드 저장
          </Button>
        </CardHeader>
        <CardContent>
          <KeywordEditor value={keywords} onChange={setKeywords} suggestions={keywordSuggestions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">옵션 구성 ({rows.length}개)</CardTitle>
          <CardDescription>
            체크박스로 여러 옵션을 선택하면 판매가·판매상태를 한 번에 수정할 수 있습니다. 소비자가는
            상품의 옵션 소비자가에서 자동 계산됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {selected.size > 0 && (
            <GroupBulkEditBar
              selectedCount={selected.size}
              onClear={() => setSelected(new Set())}
              onApply={handleBulkApply}
              loading={bulkApplying}
            />
          )}
          <GroupListingsTable
            rows={rows}
            selected={selected}
            onSelectedChange={setSelected}
            onRowSave={handleRowSave}
            savingRowId={savingRow}
          />
        </CardContent>
      </Card>
    </div>
  )
}
