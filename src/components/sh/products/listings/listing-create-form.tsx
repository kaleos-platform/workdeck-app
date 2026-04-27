'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Layers, Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  SELLER_HUB_LISTINGS_PATH,
  getSellerHubListingGroupPath,
  getSellerHubListingPath,
} from '@/lib/deck-routes'

import { CompositionBuilder, type BuiltGroup, type ProductContext } from './composition-builder'
import { CompositionRowsTable, type CompositionRow } from './composition-rows-table'
import { KeywordEditor } from './keyword-editor'
import { countChars, getChannelNameLimit } from './channel-name-limits'

const MAX_NAME_LENGTH = 200

type Channel = { id: string; name: string; kind: string }

type Props = {
  defaultChannelId?: string | null
}

export function ListingCreateForm({ defaultChannelId }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefillKey = searchParams.get('prefillKey')
  const prefillApplied = useRef(false)

  const [channels, setChannels] = useState<Channel[]>([])
  const [channelId, setChannelId] = useState<string>(defaultChannelId ?? '')
  const [baseSearchName, setBaseSearchName] = useState('')
  const [baseDisplayName, setBaseDisplayName] = useState('')
  const [internalCode, setInternalCode] = useState('')
  const [memo, setMemo] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])

  const [productCtx, setProductCtx] = useState<ProductContext | null>(null)
  const [rows, setRows] = useState<CompositionRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [builderOpen, setBuilderOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/channels?isActive=true')
        if (!res.ok) throw new Error('채널 조회 실패')
        const data: { channels: Channel[] } = await res.json()
        if (!cancelled) setChannels(data.channels ?? [])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '채널 조회 실패')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // ── pricing prefill 처리 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!prefillKey || prefillApplied.current) return

    const raw = sessionStorage.getItem(prefillKey)
    if (!raw) return

    // 1회용 — 읽은 즉시 삭제
    sessionStorage.removeItem(prefillKey)
    prefillApplied.current = true

    let prefill: { optionId: string; productId: string; retailPrice: number }
    try {
      prefill = JSON.parse(raw)
    } catch {
      toast.error('prefill 데이터 파싱 실패')
      return
    }

    const apply = async () => {
      try {
        // 상품 + 옵션 직접 fetch — productId 기반으로 정확하게 조회
        const [productRes, optionRes] = await Promise.all([
          fetch(`/api/sh/products/${prefill.productId}`),
          fetch(`/api/sh/products/${prefill.productId}/options/${prefill.optionId}`),
        ])
        if (!productRes.ok) throw new Error('상품 조회 실패')
        if (!optionRes.ok) throw new Error('옵션 조회 실패')

        const { product } = await productRes.json()
        const { option } = await optionRes.json()

        // ProductContext 구성
        const ctx: ProductContext = {
          id: product.id,
          displayName: product.internalName ?? product.name,
          officialName: product.name,
          brandName: product.brand?.name ?? null,
        }
        setProductCtx(ctx)
        if (!baseSearchName.trim()) setBaseSearchName(ctx.displayName)
        if (!baseDisplayName.trim()) setBaseDisplayName(ctx.displayName)

        // CompositionRow 1개 직접 생성 (suffix 없이 — 단일 옵션)
        const row: CompositionRow = {
          key: `prefill-${option.id}`,
          suffixParts: [],
          items: [
            {
              optionId: option.id,
              optionName: option.name,
              sku: option.sku ?? null,
              quantity: 1,
              retailPrice: option.retailPrice ?? null,
              attributeValues: option.attributeValues ?? {},
            },
          ],
          retailPrice: String(prefill.retailPrice),
          status: 'ACTIVE',
        }
        setRows([row])
        setSelected(new Set())

        toast.success('옵션 자동 선택 + 가격 미리 채움 완료')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'prefill 처리 실패')
      }
    }

    apply()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillKey])

  const currentChannel = channels.find((c) => c.id === channelId) ?? null
  const nameLimit = getChannelNameLimit(currentChannel?.name ?? null)

  const keywordSuggestions = useMemo(() => {
    const set = new Set<string>()
    if (productCtx) {
      set.add(productCtx.displayName)
      if (productCtx.brandName) set.add(productCtx.brandName)
    }
    for (const r of rows) {
      for (const s of r.suffixParts) set.add(s)
      for (const it of r.items) set.add(it.optionName)
    }
    return Array.from(set)
  }, [productCtx, rows])

  function handleBuilderCommit(ctx: ProductContext, newGroups: BuiltGroup[]) {
    setProductCtx(ctx)
    setRows(buildRowsFromGroups(newGroups))
    setSelected(new Set())
    if (!baseSearchName.trim()) setBaseSearchName(ctx.displayName)
    if (!baseDisplayName.trim()) setBaseDisplayName(ctx.displayName)
    setBuilderOpen(false)
    toast.success(`${newGroups.length}개의 옵션 구성이 준비되었습니다`)
  }

  function resetComposition() {
    setProductCtx(null)
    setRows([])
    setSelected(new Set())
    setBuilderOpen(true)
  }

  const readyToSave =
    channelId.trim().length > 0 &&
    baseSearchName.trim().length > 0 &&
    baseDisplayName.trim().length > 0 &&
    rows.length > 0

  async function handleSave() {
    if (!readyToSave) {
      toast.error('필수 항목과 구성을 확인해 주세요')
      return
    }
    setSaving(true)

    const results: Array<{
      ok: boolean
      id?: string
      error?: string
      suffix: string[]
    }> = []
    for (const row of rows) {
      const searchName = previewName(row.suffixParts, baseSearchName.trim())
      const displayName = previewName(row.suffixParts, baseDisplayName.trim())
      const payload = {
        channelId,
        searchName,
        displayName,
        internalCode: internalCode.trim()
          ? previewName(row.suffixParts, internalCode.trim())
          : undefined,
        memo: memo.trim() || undefined,
        retailPrice: row.retailPrice.trim() === '' ? undefined : Number(row.retailPrice),
        // 키워드는 ProductChannelGroupMeta에 저장 — 개별 listing에는 빈 배열
        keywords: [],
        status: row.status,
        items: row.items.map((it, idx) => ({
          optionId: it.optionId,
          quantity: it.quantity,
          sortOrder: idx,
        })),
      }
      try {
        const res = await fetch('/api/sh/products/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) {
          results.push({
            ok: false,
            error: data?.message ?? '저장 실패',
            suffix: row.suffixParts,
          })
        } else {
          results.push({ ok: true, id: data.listing.id, suffix: row.suffixParts })
        }
      } catch (err) {
        results.push({
          ok: false,
          error: err instanceof Error ? err.message : '저장 실패',
          suffix: row.suffixParts,
        })
      }
    }

    const okResults = results.filter((r) => r.ok)
    const failResults = results.filter((r) => !r.ok)

    // 키워드 저장 (ProductChannelGroupMeta)
    if (okResults.length > 0 && productCtx && keywords.length > 0) {
      try {
        await fetch(`/api/sh/products/listings/groups/${productCtx.id}/${channelId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keywords }),
        })
      } catch {
        // 키워드 저장 실패는 치명적이지 않음 — 토스트 경고만
        toast.warning('listing은 생성되었으나 키워드 저장에 실패했습니다')
      }
    }

    setSaving(false)

    if (okResults.length === 0) {
      toast.error(failResults[0]?.error ?? '저장 실패')
      return
    }
    if (failResults.length > 0) {
      toast.warning(
        `${okResults.length}개 저장 성공 · ${failResults.length}개 실패 — ${failResults
          .map((r) => r.suffix.join(' '))
          .join(', ')}`
      )
    } else {
      toast.success(`${okResults.length}개의 판매채널 상품이 생성되었습니다`)
    }

    // 상품 × 채널 그룹 상세로 이동 (productCtx 있을 때), 아니면 목록으로
    if (productCtx) {
      router.push(getSellerHubListingGroupPath(productCtx.id, channelId))
    } else if (okResults.length === 1 && okResults[0].id) {
      router.push(getSellerHubListingPath(okResults[0].id))
    } else {
      router.push(SELLER_HUB_LISTINGS_PATH)
    }
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
          <Button variant="outline" onClick={() => router.back()} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={!readyToSave || saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            저장 ({rows.length}개 생성)
          </Button>
        </div>
      </div>

      {/* 1) 기본 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">기본 정보</CardTitle>
          <CardDescription>
            생성될 모든 listing에 공통으로 적용되는 값. 개별 옵션 suffix는 자동으로 덧붙습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="listing-channel">판매채널 *</Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger id="listing-channel">
                  <SelectValue placeholder="채널을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {channels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="listing-code">관리 코드 (접두어)</Label>
              <Input
                id="listing-code"
                value={internalCode}
                onChange={(e) => setInternalCode(e.target.value)}
                placeholder="예: CP-MUD — 뒤에 속성 suffix가 붙어 각 listing에 설정됩니다"
                maxLength={50}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="listing-search">상품명 (검색용) *</Label>
              <NameCounter value={baseSearchName} limit={nameLimit.searchName} />
            </div>
            <Input
              id="listing-search"
              value={baseSearchName}
              onChange={(e) => setBaseSearchName(e.target.value)}
              placeholder="예: 프리미엄 머드팬티"
              maxLength={MAX_NAME_LENGTH - 30}
            />
            <p className="text-xs text-muted-foreground">
              생성 시 속성값(예: S / M / L)이 자동으로 뒤에 붙습니다
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="listing-display">상품명 (노출용) *</Label>
              <NameCounter value={baseDisplayName} limit={nameLimit.displayName} />
            </div>
            <Input
              id="listing-display"
              value={baseDisplayName}
              onChange={(e) => setBaseDisplayName(e.target.value)}
              placeholder="상세 페이지에 표시되는 상품명"
              maxLength={MAX_NAME_LENGTH - 30}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="listing-memo">메모</Label>
            <Textarea
              id="listing-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="내부 참고용 메모"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* 2) 키워드 (상품 단위) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">키워드 (상품 단위)</CardTitle>
          <CardDescription>
            {currentChannel
              ? `${currentChannel.name} 상의 이 상품에 공통 적용되는 검색 키워드`
              : '채널을 선택하면 이 상품의 검색 키워드가 저장됩니다'}
            . 최대 30개.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KeywordEditor value={keywords} onChange={setKeywords} suggestions={keywordSuggestions} />
        </CardContent>
      </Card>

      {/* 3) 구성 옵션 — 편집 테이블 or CTA */}
      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">구성 옵션</CardTitle>
            <CardDescription>묶음에 포함할 상품과 옵션을 선택합니다</CardDescription>
          </CardHeader>
          <CardContent>
            <button
              type="button"
              onClick={() => setBuilderOpen(true)}
              disabled={saving}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 px-4 py-10 text-sm text-muted-foreground transition hover:border-primary/50 hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="flex items-center gap-2 text-base font-medium text-foreground">
                <Layers className="h-5 w-5" />
                구성 만들기
              </div>
              <span className="text-xs">상품과 속성을 단계별로 선택해 묶음 구성을 만듭니다</span>
              <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                <Plus className="h-3.5 w-3.5" />
                시작
              </span>
            </button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-lg">구성 옵션 ({rows.length}개)</CardTitle>
              <CardDescription>
                각 행마다 판매가·판매상태를 설정하세요. 체크박스로 여러 옵션을 선택하면 한번에
                수정할 수 있습니다. 소비자가는 옵션 소비자가에서 자동 계산됩니다.
              </CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={resetComposition}>
              <X className="mr-1 h-4 w-4" />
              구성 다시 만들기
            </Button>
          </CardHeader>
          <CardContent>
            <CompositionRowsTable
              rows={rows}
              baseSearchName={baseSearchName}
              onRowsChange={setRows}
              selected={selected}
              onSelectedChange={setSelected}
              disabled={saving}
            />
          </CardContent>
        </Card>
      )}

      <Dialog
        open={builderOpen}
        onOpenChange={(v) => {
          if (!saving) setBuilderOpen(v)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>판매채널 상품 구성 만들기</DialogTitle>
            <DialogDescription>
              상품과 속성을 선택해 묶음 구성을 만듭니다. 여러 조합이 나오면 listing이 자동으로 분할
              생성됩니다.
            </DialogDescription>
          </DialogHeader>
          <CompositionBuilder onCommit={handleBuilderCommit} disabled={saving} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function previewName(suffix: string[], base: string) {
  if (!base) return ''
  if (suffix.length === 0) return base
  return `${base} ${suffix.join(' ')}`
}

function buildRowsFromGroups(groups: BuiltGroup[]): CompositionRow[] {
  return groups.map((g, idx) => ({
    key: `g${idx}-${g.suffixParts.join('-') || 'default'}`,
    suffixParts: g.suffixParts,
    items: g.items,
    retailPrice: '',
    status: 'ACTIVE',
  }))
}

function NameCounter({ value, limit }: { value: string; limit?: number }) {
  const n = countChars(value)
  const overflow = limit != null && n > limit
  const color = overflow ? 'text-destructive' : 'text-muted-foreground'
  return (
    <span className={`text-xs ${color}`}>
      {n}
      {limit != null ? ` / ${limit}(가이드)` : ` / ${MAX_NAME_LENGTH - 30}`}
    </span>
  )
}
