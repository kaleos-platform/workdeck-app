'use client'

// "재고 데이터 없는 상품" — 이번 대조에 등장하지 않은 시스템 옵션을 상품 단위로 묶어 보여준다.
//
// 대조 테이블은 파일/데이터 연동 기준 워킹셋이라 시스템 쪽 미등장 옵션을 담지 않는다.
// 여기는 기본적으로 읽기 전용이고, 자동 대조가 손대지 못하는 건(system-only + 외부 SKU 미연결)
// 에만 [쿠팡 SKU 연결] 을 제공한다. 이 연결은 *다음 회차* 자동 대조를 가능하게 하는 작업이라
// 대조가 확정됐어도 막지 않는다.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Link2, Loader2, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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

type UnmatchedOption = {
  id: string
  name: string
  quantity: number
  /** system-only 인데 외부 SKU 매핑이 없음 — 자동 대조가 재고를 건드리지 못한다 */
  needsLink: boolean
}

type UnmatchedProduct = {
  id: string
  name: string
  options: UnmatchedOption[]
  unmatchedCount: number
  stockSum: number
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  reconciliationId: string
  locationId: string
  locationName: string
  /** SKU 연결 후 상위 화면(대조 상세·목록)을 갱신 */
  onLinked?: () => void
}

const PAGE_SIZE = 10

export function ReconciliationUnmatchedOptionsDialog({
  open,
  onOpenChange,
  reconciliationId,
  locationId,
  locationName,
  onLinked,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [products, setProducts] = useState<UnmatchedProduct[]>([])
  const [totalProducts, setTotalProducts] = useState(0)
  const [totalOptions, setTotalOptions] = useState(0)
  const [needsLinkTotal, setNeedsLinkTotal] = useState(0)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [needsLinkOnly, setNeedsLinkOnly] = useState(false)
  const [page, setPage] = useState(1)

  // SKU 연결 다이얼로그 상태
  const [linkTarget, setLinkTarget] = useState<{
    productName: string
    option: UnmatchedOption
  } | null>(null)
  const [linkCode, setLinkCode] = useState('')
  const [linkSaving, setLinkSaving] = useState(false)
  const [existingMappings, setExistingMappings] = useState<ExistingMapping[]>([])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  // 검색어·필터가 바뀌면 1페이지로
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, needsLinkOnly])

  // 열릴 때마다 초기화 — 직전에 보던 검색·페이지가 남아 있으면 빈 화면처럼 보인다
  useEffect(() => {
    if (!open) return
    setSearch('')
    setDebouncedSearch('')
    setNeedsLinkOnly(false)
    setPage(1)
  }, [open])

  const load = useCallback(async () => {
    if (!open) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (needsLinkOnly) params.set('needsLinkOnly', '1')

      const res = await fetch(
        `/api/sh/inventory/reconciliation/${reconciliationId}/unmatched-options?${params}`
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '조회 실패')
      setProducts(data.products ?? [])
      setTotalProducts(data.totalProducts ?? 0)
      setTotalOptions(data.totalOptions ?? 0)
      setNeedsLinkTotal(data.needsLinkTotal ?? 0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [open, reconciliationId, page, debouncedSearch, needsLinkOnly])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(totalProducts / PAGE_SIZE))

  const linkConflict = useMemo(
    () => existingMappings.find((m) => m.externalCode === linkCode.trim()) ?? null,
    [existingMappings, linkCode]
  )

  async function openLink(productName: string, option: UnmatchedOption) {
    setLinkTarget({ productName, option })
    setLinkCode('')
    setExistingMappings([])
    try {
      const res = await fetch(`/api/sh/inventory/locations/${locationId}/mappings`)
      const data = await res.json()
      if (res.ok) setExistingMappings((data.mappings ?? []) as ExistingMapping[])
    } catch {
      // 조회 실패해도 입력은 가능 — 저장 직전 중복 확인이 없을 뿐이다(아래에서 재확인).
    }
  }

  // 외부 SKU 를 연결한다.
  // 연결되면 다음 회차 자동 대조부터 이 옵션이 스냅샷과 대조되고, 스냅샷에 없으면 0 처리된다.
  async function handleLinkSave() {
    if (!linkTarget) return
    const externalCode = linkCode.trim()
    if (!externalCode) {
      toast.error('쿠팡 SKU 번호를 입력해 주세요')
      return
    }

    setLinkSaving(true)
    try {
      // 이미 이 SKU 에 매핑이 있으면 PATCH 로 items 를 "추가"한다.
      // POST 는 items 를 통째로 교체(deleteMany+createMany)하므로 세트 매핑의 나머지 구성품이
      // 조용히 사라진다 — 그 옵션들이 대조에서 빠지고 매일 자동 조정이 어긋난다.
      const conflict = existingMappings.find((m) => m.externalCode === externalCode)

      let res: Response
      if (conflict) {
        if (conflict.items.some((i) => i.optionId === linkTarget.option.id)) {
          toast.info('이미 이 SKU 에 연결된 상품입니다')
          setLinkTarget(null)
          await load()
          return
        }
        res = await fetch(
          `/api/sh/inventory/locations/${locationId}/mappings?mappingId=${conflict.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [
                ...conflict.items.map((i) => ({ optionId: i.optionId, quantity: i.quantity })),
                { optionId: linkTarget.option.id, quantity: 1 },
              ],
            }),
          }
        )
      } else {
        res = await fetch(`/api/sh/inventory/locations/${locationId}/mappings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            externalCode,
            externalName: linkTarget.productName,
            externalOptionName: linkTarget.option.name,
            items: [{ optionId: linkTarget.option.id, quantity: 1 }],
          }),
        })
      }

      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'SKU 연결 실패')
      toast.success(
        conflict
          ? `SKU ${externalCode} 연결에 ${linkTarget.productName} 추가됨`
          : `${linkTarget.productName} → SKU ${externalCode} 연결됨`
      )
      setLinkTarget(null)
      await load()
      onLinked?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'SKU 연결 실패')
    } finally {
      setLinkSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>재고 데이터 없는 상품</DialogTitle>
            <DialogDescription>
              이번 대조 데이터에 등장하지 않은 시스템 상품입니다. {locationName} 기준 재고를 함께
              표시합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="상품명 · 옵션명 검색"
              className="h-9"
            />
            <Button
              type="button"
              variant={needsLinkOnly ? 'default' : 'outline'}
              size="sm"
              className="shrink-0"
              onClick={() => setNeedsLinkOnly((v) => !v)}
            >
              연결 필요만 {needsLinkTotal > 0 && `(${needsLinkTotal})`}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            미등장 옵션 {totalOptions}개 · 상품 {totalProducts}개
          </p>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : products.length === 0 ? (
              <div className="flex h-32 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {needsLinkOnly
                  ? '쿠팡 SKU 연결이 필요한 상품이 없습니다'
                  : '이번 대조에 등장하지 않은 상품이 없습니다'}
              </div>
            ) : (
              <Accordion type="multiple" className="w-full">
                {products.map((p) => (
                  <AccordionItem key={p.id} value={p.id} className="px-3">
                    <AccordionTrigger className="py-2.5 hover:no-underline">
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-medium">{p.name}</span>
                        </span>
                        <span className="shrink-0 text-xs font-normal text-muted-foreground">
                          미등장 {p.unmatchedCount} · 재고 {p.stockSum}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-2">
                      <ul className="space-y-1">
                        {p.options.map((o) => (
                          <li
                            key={o.id}
                            className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-muted-foreground">{o.name}</span>
                              {o.needsLink && (
                                <Badge className="shrink-0 border-orange-200 bg-orange-100 text-orange-700">
                                  연결 필요
                                </Badge>
                              )}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <span className="font-mono text-xs">{o.quantity}</span>
                              {o.needsLink && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => openLink(p.name, o)}
                                >
                                  <Link2 className="mr-1 h-3 w-3" />
                                  쿠팡 SKU 연결
                                </Button>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              파일에 없는 상품입니다. 이번 확정으로 재고가 0이 되지 않습니다.
            </p>
            {totalPages > 1 && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((v) => Math.max(1, v - 1))}
                >
                  이전
                </Button>
                <span className="px-1 text-xs text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((v) => Math.min(totalPages, v + 1))}
                >
                  다음
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 외부 SKU 연결 */}
      <Dialog
        open={!!linkTarget}
        onOpenChange={(v) => {
          if (!v && !linkSaving) setLinkTarget(null)
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
              <p className="font-medium">{linkTarget?.productName}</p>
              <p className="text-xs text-muted-foreground">
                {linkTarget?.option.name} · 현재 재고 {linkTarget?.option.quantity ?? 0}
              </p>
            </div>
            <Input
              value={linkCode}
              onChange={(e) => setLinkCode(e.target.value)}
              placeholder="쿠팡 SKU 번호 (예: 1234567890)"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLinkSave()
              }}
              autoFocus
            />
            {linkConflict ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-medium">이 SKU 는 이미 연결돼 있습니다</p>
                <p className="mt-0.5">
                  {linkConflict.items
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
            <Button variant="outline" onClick={() => setLinkTarget(null)} disabled={linkSaving}>
              취소
            </Button>
            <Button onClick={handleLinkSave} disabled={linkSaving || !linkCode.trim()}>
              {linkSaving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {linkConflict ? '기존 연결에 추가' : '연결'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
