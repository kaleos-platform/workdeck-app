'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Info, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { tokenizeProductName } from '@/lib/inv/search-tokens'
import { productDisplayName } from '@/lib/sh/product-display'

const PAGE_SIZE = 50

type ProductRow = {
  id: string
  name: string
  internalName?: string | null
  code: string | null
  msrp?: string | number | null
  brand?: { id: string; name: string } | null
  options: {
    id: string
    name: string
    sku: string | null
    retailPrice?: string | number | null
    totalStock?: number
  }[]
}

export type PickedOption = {
  optionId: string
  optionName: string
  productId: string
  productName: string
  sku: string | null
  brandName: string | null
  retailPrice: number | null
  totalStock: number
}

export type PickedOptionWithQty = PickedOption & { quantity: number }

type ProductWithOptions = {
  productId: string
  productName: string
  code: string | null
  brandName: string | null
  options: PickedOption[]
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  // flat/two-step 모드: 단일 선택
  onPick?: (opt: PickedOption) => void
  // multi-with-qty 모드: 다중 선택+수량
  onPickMulti?: (items: PickedOptionWithQty[]) => void
  // product-with-all-options 모드: 상품 1개를 고르면 그 상품의 모든 옵션을 한 번에 전달
  onPickProduct?: (productId: string, opts: PickedOption[]) => void
  excludeOptionIds?: string[]
  initialQuery?: string
  // 'flat' (default): 상품+옵션을 한 리스트로 표시
  // 'two-step': 1단계 상품 선택 → 2단계 그 상품의 옵션 선택
  // 'multi-with-qty': two-step + 다중 체크박스+수량 입력, onPickMulti 사용
  // 'product-with-all-options': 상품 목록만 표시, 클릭 시 그 상품의 전체 옵션 일괄 전달
  mode?: 'flat' | 'two-step' | 'multi-with-qty' | 'product-with-all-options'
  contextLabel?: string
  contextValue?: string
  // multi-with-qty 수정 시 기존 선택 복원
  initialItems?: PickedOptionWithQty[]
  // 검색 시 공식 상품명(name)도 매칭 대상에 포함(재고조정 상품명 추천용). 기본 false.
  searchOfficialName?: boolean
  // 파일 상품명 등 원본 문자열. 넘기면 단어별 키워드 칩 UI를 띄우고 앞 N개 토큰으로 검색을 시작한다.
  keywordSource?: string
  // keywordSource 사용 시 처음 선택 상태로 둘 앞쪽 토큰 수(기본 2)
  initialTokenCount?: number
  // 검색어를 토큰 AND로 매칭(서버 tokenized=1). keywordSource와 함께 쓰는 것을 전제.
  tokenized?: boolean
}

export function OptionPickerDialog({
  open,
  onOpenChange,
  onPick,
  onPickMulti,
  onPickProduct,
  excludeOptionIds = [],
  initialQuery = '',
  mode = 'flat',
  contextLabel,
  contextValue,
  initialItems,
  searchOfficialName = false,
  keywordSource,
  initialTokenCount = 2,
  tokenized = false,
}: Props) {
  const keywordTokens = useMemo(
    () => (keywordSource ? tokenizeProductName(keywordSource) : []),
    [keywordSource]
  )
  // keywordSource가 있으면 전체 문자열 대신 앞쪽 토큰 몇 개만 초기 검색어로 쓴다.
  const seedQuery = useMemo(
    () =>
      keywordTokens.length > 0
        ? keywordTokens.slice(0, Math.max(1, initialTokenCount)).join(' ')
        : initialQuery,
    [keywordTokens, initialTokenCount, initialQuery]
  )

  const [search, setSearch] = useState(seedQuery)
  const [debounced, setDebounced] = useState(seedQuery)
  const [relaxedNote, setRelaxedNote] = useState<string | null>(null)
  const [products, setProducts] = useState<ProductWithOptions[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)

  // multi-with-qty: 누적 선택 items (여러 상품에 걸쳐 유지)
  const [accumulatedItems, setAccumulatedItems] = useState<PickedOptionWithQty[]>([])

  // 0건 자동 완화는 시드/칩 클릭으로 만들어진 검색어에만 적용한다.
  // 직접 타이핑 중에는 완화하지 않는다(입력 중간 상태를 멋대로 잘라내면 방해).
  const autoRelaxRef = useRef(false)

  // 호출부가 initialItems/initialQuery를 인라인으로 넘기면 매 렌더 identity가 바뀐다.
  // deps에 그대로 두면 사용자가 고친 검색어·쌓아둔 페이지가 되돌아가므로 ref로 잡고
  // 시드는 open 전환에서만 수행한다.
  const seedRef = useRef({ seedQuery, initialItems })
  seedRef.current = { seedQuery, initialItems }

  useEffect(() => {
    if (open) {
      const { seedQuery: q, initialItems: items } = seedRef.current
      setSearch(q)
      setDebounced(q)
      setSelectedProductId(null)
      setRelaxedNote(null)
      autoRelaxRef.current = true
      setPage(1)
      // initialItems로 복원 또는 초기화
      setAccumulatedItems(items ? [...items] : [])
    } else {
      // 닫힐 때 누적 state 초기화
      setAccumulatedItems([])
    }
  }, [open])

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const qs = new URLSearchParams()
        qs.set('page', String(page))
        qs.set('pageSize', String(PAGE_SIZE))
        if (debounced.trim()) qs.set('search', debounced.trim())
        if (searchOfficialName) qs.set('includeName', '1')
        if (tokenized) qs.set('tokenized', '1')
        const res = await fetch(`/api/sh/products?${qs.toString()}`)
        if (!res.ok) throw new Error('검색 실패')
        const data: { data?: ProductRow[]; products?: ProductRow[]; total?: number } =
          await res.json()
        if (cancelled) return
        const rows = data.data ?? data.products ?? []
        const grouped: ProductWithOptions[] = rows.map((p) => {
          const productMsrp = p.msrp != null ? Number(p.msrp) : null
          const displayName = productDisplayName(p)
          const brandName = p.brand?.name ?? null
          return {
            productId: p.id,
            productName: displayName,
            code: p.code,
            brandName,
            options: (p.options ?? []).map((o) => ({
              optionId: o.id,
              optionName: o.name,
              productId: p.id,
              productName: displayName,
              sku: o.sku,
              brandName,
              retailPrice: o.retailPrice != null ? Number(o.retailPrice) : productMsrp,
              totalStock: typeof o.totalStock === 'number' ? o.totalStock : 0,
            })),
          }
        })
        setTotal(typeof data.total === 'number' ? data.total : rows.length)
        // page > 1은 append(더 보기), page 1은 교체(검색어 변경/최초 로드)
        setProducts((prev) => (page > 1 ? [...prev, ...grouped] : grouped))

        // 0건이면 마지막 토큰을 떼고 자동 재검색 — 토큰이 1개 남을 때까지 단계적으로 완화.
        if (page === 1 && rows.length === 0 && autoRelaxRef.current) {
          const tokens = tokenizeProductName(debounced)
          if (tokens.length > 1) {
            const next = tokens.slice(0, -1).join(' ')
            setRelaxedNote(next)
            setSearch(next)
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '검색 실패')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, debounced, page, searchOfficialName])

  // 칩 선택 상태는 별도 state 없이 현재 검색어에서 파생 — 직접 타이핑과 어긋나지 않는다.
  const activeTokens = useMemo(
    () => new Set(tokenizeProductName(search).map((t) => t.toLowerCase())),
    [search]
  )

  function toggleKeywordToken(token: string) {
    const current = tokenizeProductName(search)
    const key = token.toLowerCase()
    const next = current.some((t) => t.toLowerCase() === key)
      ? current.filter((t) => t.toLowerCase() !== key)
      : [...current, token]
    // 칩 클릭은 명시적 조건 지정이므로 자동 완화하지 않는다(누른 단어가 곧바로 떨어져 나가면 오작동으로 보임).
    autoRelaxRef.current = false
    setRelaxedNote(null)
    setSearch(next.join(' '))
  }

  const hasMore = products.length < total

  const excluded = useMemo(() => new Set(excludeOptionIds), [excludeOptionIds])

  const flatVisible = useMemo(
    () => products.flatMap((p) => p.options).filter((o) => !excluded.has(o.optionId)),
    [products, excluded]
  )

  const productsVisible = useMemo(() => {
    if (mode === 'product-with-all-options') {
      return products.filter((p) => p.options.length > 0)
    }
    return products
      .map((p) => ({ ...p, options: p.options.filter((o) => !excluded.has(o.optionId)) }))
      .filter((p) => p.options.length > 0)
  }, [products, excluded, mode])

  const selectedProduct = useMemo(
    () => productsVisible.find((p) => p.productId === selectedProductId) ?? null,
    [productsVisible, selectedProductId]
  )

  const isMultiMode = mode === 'multi-with-qty'
  const isProductAllMode = mode === 'product-with-all-options'
  const showProductStep =
    (mode === 'two-step' || isMultiMode || isProductAllMode) && !selectedProduct
  const showOptionStep = (mode === 'two-step' || isMultiMode) && !!selectedProduct

  // multi-with-qty: 현재 상품의 옵션에 대한 체크/수량 변경
  function toggleOptionCheck(opt: PickedOption, checked: boolean) {
    setAccumulatedItems((prev) => {
      if (checked) {
        if (prev.some((i) => i.optionId === opt.optionId)) return prev
        return [...prev, { ...opt, quantity: 1 }]
      } else {
        return prev.filter((i) => i.optionId !== opt.optionId)
      }
    })
  }

  function updateOptionQty(optionId: string, raw: string) {
    const parsed = parseInt(raw, 10)
    const qty = isNaN(parsed) || parsed < 1 ? 1 : parsed
    setAccumulatedItems((prev) =>
      prev.map((i) => (i.optionId === optionId ? { ...i, quantity: qty } : i))
    )
  }

  function handleMultiComplete() {
    if (accumulatedItems.length === 0) {
      toast.error('옵션을 하나 이상 선택하세요')
      return
    }
    onPickMulti?.(accumulatedItems)
    onOpenChange(false)
  }

  const titleText = useMemo(() => {
    if (isProductAllMode) return '상품 선택'
    if (isMultiMode) {
      if (showProductStep) return '상품 선택'
      return `옵션 선택 — ${selectedProduct?.productName ?? ''}`
    }
    if (mode === 'two-step') {
      if (showProductStep) return '상품 선택'
      return `옵션 선택 — ${selectedProduct?.productName ?? ''}`
    }
    return '옵션 선택'
  }, [isProductAllMode, isMultiMode, mode, showProductStep, selectedProduct])

  const descText = useMemo(() => {
    if (isProductAllMode) return '상품을 선택하면 해당 상품의 모든 옵션이 추가됩니다'
    if (isMultiMode) {
      if (showProductStep) return '상품을 선택하세요 (여러 상품 추가 가능)'
      return '옵션별 체크박스와 수량을 설정하세요'
    }
    if (mode === 'two-step') {
      if (showProductStep) return '상품을 먼저 선택하세요'
      return '옵션을 선택하세요'
    }
    return '상품명·관리코드로 검색해 묶음에 포함할 옵션을 선택하세요'
  }, [isProductAllMode, isMultiMode, mode, showProductStep])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl">
        <DialogHeader>
          <DialogTitle>{titleText}</DialogTitle>
          <DialogDescription>{descText}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {contextValue && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <span className="text-xs text-amber-700">{contextLabel ?? '매칭 대상'}</span>
              <p className="mt-0.5 font-medium text-amber-900">{contextValue}</p>
            </div>
          )}

          {showOptionStep && (
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 w-fit"
                onClick={() => setSelectedProductId(null)}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                다른 상품 선택
              </Button>
              {isMultiMode && accumulatedItems.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  선택된 옵션 {accumulatedItems.length}개
                </span>
              )}
            </div>
          )}

          {!showOptionStep && keywordTokens.length > 0 && (
            <div className="space-y-1">
              <Label>키워드</Label>
              <div className="flex flex-wrap gap-1.5">
                {keywordTokens.map((token) => {
                  const selected = activeTokens.has(token.toLowerCase())
                  return (
                    <Button
                      key={token}
                      type="button"
                      size="sm"
                      variant={selected ? 'default' : 'outline'}
                      className="h-7 px-2 text-xs"
                      onClick={() => toggleKeywordToken(token)}
                    >
                      {token}
                    </Button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                단어를 눌러 검색 조건을 추가/제거하세요 (선택한 단어를 모두 포함하는 상품)
              </p>
            </div>
          )}

          {!showOptionStep && (
            <div className="space-y-1">
              <Label htmlFor="option-picker-search">검색</Label>
              <div className="relative">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="option-picker-search"
                  value={search}
                  onChange={(e) => {
                    autoRelaxRef.current = false
                    setRelaxedNote(null)
                    setSearch(e.target.value)
                  }}
                  placeholder={
                    mode === 'two-step' || isMultiMode
                      ? '상품명 / 코드 / 브랜드'
                      : '상품명 / 코드 / 브랜드 / SKU'
                  }
                  className="pl-9"
                />
              </div>
              {relaxedNote && (
                <p className="text-xs text-amber-700">
                  검색 결과가 없어 검색어를 완화했습니다: {relaxedNote}
                </p>
              )}
              {isMultiMode && accumulatedItems.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  선택된 옵션 {accumulatedItems.length}개
                </p>
              )}
              {total > 0 && (
                <p className="text-xs text-muted-foreground">
                  {showProductStep
                    ? `전체 상품 ${total}개 중 ${productsVisible.length}개 표시`
                    : `전체 상품 ${total}개 중 ${products.length}개 로드 · 옵션 ${flatVisible.length}개 표시`}
                </p>
              )}
            </div>
          )}

          <div className="max-h-[50vh] overflow-y-auto rounded-md border">
            {loading && page === 1 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">검색 중...</div>
            ) : showProductStep ? (
              productsVisible.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {debounced ? '검색 결과가 없습니다' : '검색어를 입력하세요'}
                </div>
              ) : (
                <ul className="divide-y">
                  {productsVisible.map((p) => (
                    <li key={p.productId}>
                      <button
                        type="button"
                        onClick={() => {
                          if (isProductAllMode) {
                            onPickProduct?.(p.productId, p.options)
                            onOpenChange(false)
                            return
                          }
                          setSelectedProductId(p.productId)
                        }}
                        className="w-full px-4 py-3 text-left transition hover:bg-muted/60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{p.productName}</p>
                            <p className="text-sm text-muted-foreground">
                              옵션 {p.options.length}개
                              {isMultiMode &&
                                (() => {
                                  const n = p.options.filter((o) =>
                                    accumulatedItems.some((i) => i.optionId === o.optionId)
                                  ).length
                                  return n > 0 ? (
                                    <span className="ml-2 text-primary">· {n}개 선택됨</span>
                                  ) : null
                                })()}
                            </p>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            {p.code && <p>{p.code}</p>}
                            {p.brandName && <p>{p.brandName}</p>}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : showOptionStep && isMultiMode ? (
              // multi-with-qty: 체크박스 + 수량 입력
              selectedProduct!.options.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  선택 가능한 옵션이 없습니다
                </div>
              ) : (
                <ul className="divide-y">
                  {selectedProduct!.options.map((o) => {
                    const accumulated = accumulatedItems.find((i) => i.optionId === o.optionId)
                    const checked = !!accumulated
                    return (
                      <li key={o.optionId} className="flex items-center gap-3 px-4 py-3">
                        <Checkbox
                          id={`mqo-${o.optionId}`}
                          checked={checked}
                          onCheckedChange={(v) => toggleOptionCheck(o, !!v)}
                        />
                        <label
                          htmlFor={`mqo-${o.optionId}`}
                          className="flex-1 cursor-pointer text-sm font-medium"
                        >
                          {o.optionName}
                          {o.sku && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              SKU {o.sku}
                            </span>
                          )}
                        </label>
                        {checked && (
                          <div className="flex items-center gap-1">
                            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                              세트 수량
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-muted-foreground/70 hover:text-foreground"
                                      aria-label="세트 수량 안내"
                                    >
                                      <Info className="h-3 w-3" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                                    세트 구성으로 재고과 관리되는 상품일 경우 개별 상품 수량을
                                    입력해주세요.
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </span>
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              value={accumulated!.quantity}
                              onChange={(e) => updateOptionQty(o.optionId, e.target.value)}
                              className="h-7 w-16 text-center text-sm"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )
            ) : showOptionStep ? (
              // two-step 단일 선택
              selectedProduct!.options.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  선택 가능한 옵션이 없습니다
                </div>
              ) : (
                <ul className="divide-y">
                  {selectedProduct!.options.map((o) => (
                    <li key={o.optionId}>
                      <button
                        type="button"
                        onClick={() => onPick?.(o)}
                        className="w-full px-4 py-3 text-left transition hover:bg-muted/60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{o.optionName}</p>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            {o.sku && <p>SKU {o.sku}</p>}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : flatVisible.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {debounced ? '검색 결과가 없습니다' : '검색어를 입력하세요'}
              </div>
            ) : (
              <ul className="divide-y">
                {flatVisible.map((r) => (
                  <li key={r.optionId}>
                    <button
                      type="button"
                      onClick={() => onPick?.(r)}
                      className="w-full px-4 py-3 text-left transition hover:bg-muted/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{r.productName}</p>
                          <p className="text-sm text-muted-foreground">{r.optionName}</p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          {r.sku && <p>SKU {r.sku}</p>}
                          {r.brandName && <p>{r.brandName}</p>}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!showOptionStep && hasMore && (
              <div className="border-t p-2 text-center">
                {loading ? (
                  <span className="text-sm text-muted-foreground">불러오는 중...</span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                  >
                    더 보기
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          {isMultiMode ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                닫기
              </Button>
              <Button onClick={handleMultiComplete} disabled={accumulatedItems.length === 0}>
                완료 {accumulatedItems.length > 0 && `(${accumulatedItems.length}개)`}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              닫기
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
