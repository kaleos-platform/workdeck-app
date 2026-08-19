'use client'

// 상품명 작성 SOP 위저드 — 가이드 §22 STEP 01~08.
//
// 상태는 전부 이 컴포넌트의 로컬이다. 초안을 DB 에 저장하지 않으므로 중간에 이탈하면 사라진다.
// 저장은 마지막 STEP 08 에서 `saveToListing` 한 곳으로만 나간다 —
// 변경 이력 게이트(§25-26)도 같은 함수 안에 있다.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getSellerHubListingPath, SELLER_HUB_LISTINGS_PATH } from '@/lib/deck-routes'
import {
  DEFAULT_KEYWORD_RULES,
  rulesForNameField,
  type KeywordRuleSet,
} from '@/lib/sh/keyword-rules'
import type { KeywordTypeKey } from '@/lib/sh/keyword-score'
import { diffKeywordChange } from '@/lib/sh/keyword-change'
import { cn } from '@/lib/utils'

import { KeywordChangeDialog, type KeywordChangeMeta } from './keyword-change-dialog'

import { StepFactSheet, type ProductHints } from './steps/step-01-fact-sheet'
import { StepMainKeyword } from './steps/step-02-main-keyword'
import { StepSubKeywords } from './steps/step-03-sub-keywords'
import { composeName, StepComposeName } from './steps/step-04-compose-name'
import { MANUAL_CHECKS, StepCleanName, type ManualCheckKey } from './steps/step-05-clean-name'
import { StepResearch, type AdTermsState } from './steps/step-06-research'
import { StepClassify } from './steps/step-07-classify'
import { StepDedupe } from './steps/step-08-dedupe'
import {
  EMPTY_FACT_SHEET,
  STEP_TITLES,
  resolveBaseProduct,
  type FactSheet,
  type NameParts,
  type ResearchSource,
  type ResearchTerm,
} from './steps/naming-sop-types'

const STEP_COUNT = STEP_TITLES.length

type ListingContext = {
  id: string
  channelId: string
  channelName: string
  searchName: string
  keywords: string[]
  productId: string | null
  /** 구성 옵션이 여러 상품에 걸쳐 있어 기준 상품을 특정하지 못한 경우 */
  mixedProducts: boolean
  optionNames: string[]
}

type ProductContext = {
  name: string
  brandName: string | null
  groupId: string
  hints: ProductHints
  optionAttributeNames: string[]
  optionAttributeValues: string[]
}

/** Json 컬럼에서 표시 가능한 문자열만 추린다(형태를 신뢰할 수 없다). */
function toStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>
        for (const key of ['name', 'label', 'value', 'title']) {
          if (typeof rec[key] === 'string') return rec[key] as string
        }
      }
      return ''
    })
    .map((v) => v.trim())
    .filter(Boolean)
}

type OptionAttribute = { name?: unknown; values?: unknown }

export function NamingSopWizard({ listingId }: { listingId: string | null }) {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(listingId != null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [listing, setListing] = useState<ListingContext | null>(null)
  const [product, setProduct] = useState<ProductContext | null>(null)
  const [categoryNames, setCategoryNames] = useState<string[]>([])
  const [rules, setRules] = useState<KeywordRuleSet>(DEFAULT_KEYWORD_RULES)
  const [adTerms, setAdTerms] = useState<AdTermsState>({
    loading: false,
    linked: false,
    data: [],
    skipped: 'no-listing',
  })

  const [factSheet, setFactSheet] = useState<FactSheet>(EMPTY_FACT_SHEET)
  const [mainKeyword, setMainKeyword] = useState('')
  const [subKeywords, setSubKeywords] = useState<string[]>(['', '', ''])
  const [nameParts, setNameParts] = useState<NameParts>({
    brand: '',
    keyFeature: '',
    main: '',
    subFeature: '',
    spec: '',
  })
  const [productName, setProductName] = useState('')
  const [manualChecks, setManualChecks] = useState<Record<ManualCheckKey, boolean>>({
    filler: false,
    falseClaim: false,
  })
  /** STEP04 에서 사용자가 직접 고친 조각. 여기 없는 조각은 앞 단계 입력을 계속 따라간다. */
  const [touchedParts, setTouchedParts] = useState<Set<keyof NameParts>>(new Set())
  const [terms, setTerms] = useState<ResearchTerm[]>([])
  const [finalKeywords, setFinalKeywords] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [gateOpen, setGateOpen] = useState(false)

  // ─── 초기 로드 ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!listingId) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const res = await fetch(`/api/sh/products/listings/${listingId}`)
        if (!res.ok) throw new Error('판매채널 상품을 불러오지 못했습니다')
        const data = await res.json()
        const l = data.listing as {
          id: string
          channel: { id: string; name: string }
          searchName: string
          keywords: string[]
          items: { productId: string; optionName: string }[]
        }
        if (cancelled) return

        // 세트·묶음은 구성 옵션이 여러 상품에 걸친다 — 기준 상품은 하나로 좁혀질 때만 쓴다.
        const base = resolveBaseProduct(l.items)

        const ctx: ListingContext = {
          id: l.id,
          channelId: l.channel.id,
          channelName: l.channel.name,
          searchName: l.searchName,
          keywords: l.keywords ?? [],
          productId: base.productId,
          mixedProducts: base.mixedProducts,
          optionNames: l.items.map((it) => it.optionName).filter(Boolean),
        }
        setListing(ctx)
        setProductName(ctx.searchName)
        setTerms(
          ctx.keywords.map((keyword) => ({
            keyword,
            source: 'INTERNAL' as ResearchSource,
            type: 'UNCLASSIFIED' as KeywordTypeKey,
          }))
        )
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : '불러오지 못했습니다')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [listingId])

  // 채널 규칙 — 행이 없으면 API 가 기본값을 돌려준다.
  // 응답에는 specialCharPattern 이 없으므로(직렬화 불가) 기본 규칙 위에 덮어쓴다.
  // 채널 오버라이드는 숫자·금지어만 바꾸므로(KeywordRuleOverride) 이 병합은 서버 계산과 동일하다.
  useEffect(() => {
    const channelId = listing?.channelId
    if (!channelId) return
    let cancelled = false

    fetch(`/api/channels/${channelId}/keyword-rules`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.rules) return
        setRules({ ...DEFAULT_KEYWORD_RULES, ...data.rules })
      })
      .catch(() => {
        /* 규칙 조회 실패는 기본값으로 진행한다 */
      })

    return () => {
      cancelled = true
    }
  }, [listing?.channelId])

  // 상품 정보 + 카테고리명
  useEffect(() => {
    const productId = listing?.productId
    if (!productId) return
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(`/api/sh/products/${productId}`)
        if (!res.ok) return
        const { product: p } = await res.json()
        if (cancelled || !p) return

        const attrs: OptionAttribute[] = Array.isArray(p.optionAttributes) ? p.optionAttributes : []
        const ctx: ProductContext = {
          name: p.name ?? '',
          brandName: p.brand?.name ?? null,
          groupId: p.groupId ?? '',
          hints: {
            nameEn: p.nameEn ?? null,
            manufacturer: p.manufacturer ?? null,
            manufactureCountry: p.manufactureCountry ?? null,
            msrp: p.msrp != null ? Number(p.msrp) : null,
            features: toStringList(p.features),
            certifications: toStringList(p.certifications),
          },
          optionAttributeNames: attrs
            .map((a) => (typeof a?.name === 'string' ? a.name.trim() : ''))
            .filter(Boolean),
          optionAttributeValues: attrs.flatMap((a) => toStringList(a?.values)),
        }
        setProduct(ctx)

        const groupsRes = await fetch('/api/sh/inventory/product-groups')
        if (!groupsRes.ok || cancelled) return
        const { groups } = (await groupsRes.json()) as { groups: { id: string; name: string }[] }
        const matched = groups.find((g) => g.id === ctx.groupId)
        if (matched && !cancelled) setCategoryNames([matched.name])
      } catch {
        /* 프리필 실패는 자유 입력으로 진행한다 */
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [listing?.productId])

  // 광고 검색어 — 상품을 특정할 수 없으면 호출 자체를 하지 않는다.
  useEffect(() => {
    const productId = listing?.productId
    if (!productId) {
      setAdTerms({
        loading: false,
        linked: false,
        data: [],
        skipped: listing?.mixedProducts ? 'mixed-products' : 'no-listing',
      })
      return
    }
    let cancelled = false
    setAdTerms({ loading: true, linked: false, data: [], skipped: false })

    fetch(`/api/sh/keywords/ad-terms?productId=${encodeURIComponent(productId)}`)
      .then((res) => (res.ok ? res.json() : { data: [], linked: false }))
      .then((data) => {
        if (cancelled) return
        setAdTerms({
          loading: false,
          linked: Boolean(data.linked),
          data: Array.isArray(data.data) ? data.data : [],
          skipped: false,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setAdTerms({ loading: false, linked: false, data: [], skipped: false })
        }
      })

    return () => {
      cancelled = true
    }
  }, [listing?.productId, listing?.mixedProducts])

  // 상품 정보가 오면 Fact Sheet 의 "채울 수 있는 칸"만 채운다. 사용자가 이미 손댄 칸은 두고,
  // 소재·용도·대상은 대응 컬럼이 없으므로 비워둔다(features 는 참고 정보로만 보여준다).
  useEffect(() => {
    if (!product) return
    setFactSheet((prev) => ({
      ...prev,
      brand: prev.brand || (product.brandName ?? ''),
      options: prev.options || product.optionAttributeNames.join(', '),
    }))
  }, [product])

  useEffect(() => {
    if (categoryNames.length === 0) return
    setFactSheet((prev) => ({ ...prev, productGroup: prev.productGroup || categoryNames[0] }))
  }, [categoryNames])

  // STEP 04 조각은 앞 단계 입력에서 파생된다. "값이 비어 있을 때만 채우기"로 하면
  // Fact Sheet 를 고쳐도 조각이 옛날 값에 머물러 상품명이 조용히 어긋난다.
  // 그래서 **사용자가 직접 고친 조각만** 예외로 두고 나머지는 항상 따라가게 한다.
  useEffect(() => {
    setNameParts((prev) => {
      const next = { ...prev }
      if (!touchedParts.has('brand')) next.brand = factSheet.brand
      if (!touchedParts.has('keyFeature')) next.keyFeature = factSheet.keyFeature
      if (!touchedParts.has('spec')) {
        next.spec = [factSheet.spec, factSheet.quantity]
          .map((v) => v.trim())
          .filter(Boolean)
          .join(' ')
      }
      if (!touchedParts.has('main')) next.main = mainKeyword
      if (!touchedParts.has('subFeature')) {
        next.subFeature = subKeywords
          .map((v) => v.trim())
          .filter(Boolean)
          .join(' ')
      }
      return next
    })
  }, [
    factSheet.brand,
    factSheet.keyFeature,
    factSheet.spec,
    factSheet.quantity,
    mainKeyword,
    subKeywords,
    touchedParts,
  ])

  const optionNames = useMemo(() => {
    if (listing && listing.optionNames.length > 0) return listing.optionNames
    return product?.optionAttributeValues ?? []
  }, [listing, product])

  const typeOf = useCallback(
    (keyword: string): KeywordTypeKey => {
      const hit = terms.find((t) => t.keyword.toLowerCase() === keyword.trim().toLowerCase())
      return hit?.type ?? 'UNCLASSIFIED'
    },
    [terms]
  )

  function addTerms(keywords: string[], source: ResearchSource) {
    setTerms((prev) => {
      const seen = new Set(prev.map((t) => t.keyword.toLowerCase()))
      const next = [...prev]
      for (const raw of keywords) {
        const keyword = raw.trim()
        if (!keyword || seen.has(keyword.toLowerCase())) continue
        seen.add(keyword.toLowerCase())
        next.push({ keyword, source, type: 'UNCLASSIFIED' })
      }
      return next
    })
  }

  function updatePart(key: keyof NameParts, value: string) {
    setTouchedParts((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
    setNameParts((prev) => ({ ...prev, [key]: value }))
  }

  function goToStep(next: number) {
    const clamped = Math.max(0, Math.min(STEP_COUNT - 1, next))
    // STEP 08 목록이 비어 있으면 수집한 후보로 채운다.
    // "처음 한 번만" 으로 하면 STEP 06 전에 STEP 08 을 눌러본 순간 시드가 소진되어
    // 이후 조사한 검색어가 영영 올라오지 않는다.
    if (clamped === 7 && finalKeywords.length === 0) {
      setFinalKeywords(terms.map((t) => t.keyword))
    }
    setStep(clamped)
  }

  /** 저장될 검색어 — 게이트 판정과 요청 본문이 같은 값을 봐야 한다. */
  const keywordsToSave = useMemo(
    () => finalKeywords.map((k) => k.trim()).filter(Boolean),
    [finalKeywords]
  )

  // §25-26 게이트. 위저드는 언제나 **기존 리스팅**을 고치는 흐름이라(listing 없이는 저장 자체가
  // 불가능하다) 사유 기본값을 두지 않는다 — 최초 등록으로 미리 채우면 진짜 개명이 그 라벨로
  // 잘못 기록되고, 무엇보다 미리 채워진 사유는 게이트를 무력화한다.
  const keywordChange = useMemo(
    () =>
      diffKeywordChange({
        beforeName: listing?.searchName,
        afterName: productName,
        beforeKeywords: listing?.keywords ?? [],
        afterKeywords: keywordsToSave,
      }),
    [listing?.searchName, listing?.keywords, productName, keywordsToSave]
  )

  /**
   * 저장 — 유일한 쓰기 경로. searchName 과 keywords 만 리스팅에 반영한다.
   * 상품명·검색어가 실제로 바뀌었으면 변경 이력 게이트(§25-26)를 먼저 거친다.
   */
  async function saveToListing(changeMeta?: KeywordChangeMeta) {
    if (!listing) return
    const name = productName.trim()
    if (!name) {
      toast.error('상품명을 입력해주세요')
      return
    }
    if (keywordChange.changed && !changeMeta) {
      setGateOpen(true)
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/sh/products/listings/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchName: name,
          keywords: keywordsToSave,
          ...(changeMeta ?? {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message ?? '저장에 실패했습니다')
      }
      // 반영된 값을 기준선으로 올린다 — 그대로 한 번 더 저장할 때 게이트가 다시 뜨지 않도록.
      setListing((prev) => (prev ? { ...prev, searchName: name, keywords: keywordsToSave } : prev))
      setGateOpen(false)
      toast.success('상품명과 검색어를 반영했습니다')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        불러오는 중...
      </p>
    )
  }

  const manualDone = MANUAL_CHECKS.every((c) => manualChecks[c.key])
  const canGoNext = step !== 1 || mainKeyword.trim().length > 0
  const isLast = step === STEP_COUNT - 1

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2 h-7 gap-1 px-2 text-xs">
            <Link href={listing ? getSellerHubListingPath(listing.id) : SELLER_HUB_LISTINGS_PATH}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              {listing ? '판매채널 상품으로' : '목록으로'}
            </Link>
          </Button>
          {listing && (
            <span className="text-xs text-muted-foreground">
              {listing.channelName} · {listing.searchName}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold">상품명 작성 SOP</h1>
        <p className="text-sm text-muted-foreground">
          8단계를 순서대로 진행해 상품명과 검색어를 정리합니다.
          {!listing && ' 저장 대상이 없어 연습용으로만 사용됩니다.'}
          {listing?.mixedProducts &&
            ' 구성 옵션이 여러 상품에 걸쳐 있어 상품 정보 자동 채우기는 건너뜁니다.'}
        </p>
      </header>

      {loadError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {loadError}
        </p>
      )}

      {/* 단계 이동 */}
      <nav aria-label="단계" className="overflow-x-auto">
        <ol className="flex min-w-max gap-1">
          {STEP_TITLES.map((title, idx) => {
            const active = idx === step
            return (
              <li key={title}>
                <button
                  type="button"
                  onClick={() => goToStep(idx)}
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'flex min-h-11 flex-col items-start rounded-md border px-3 py-1.5 text-left transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-transparent text-muted-foreground hover:bg-muted'
                  )}
                >
                  <span className="text-[11px] tabular-nums">
                    STEP {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className="text-xs font-medium">{title}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            STEP {String(step + 1).padStart(2, '0')}. {STEP_TITLES[step]}
          </CardTitle>
          <CardDescription>
            {step + 1} / {STEP_COUNT} 단계
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 0 && (
            <StepFactSheet
              value={factSheet}
              onChange={setFactSheet}
              hints={product?.hints ?? null}
              productName={product?.name ?? listing?.searchName ?? null}
            />
          )}
          {step === 1 && (
            <StepMainKeyword value={mainKeyword} onChange={setMainKeyword} factSheet={factSheet} />
          )}
          {step === 2 && (
            <StepSubKeywords value={subKeywords} onChange={setSubKeywords} factSheet={factSheet} />
          )}
          {step === 3 && (
            <StepComposeName
              parts={nameParts}
              onPartChange={updatePart}
              name={productName}
              onNameChange={setProductName}
              rules={rulesForNameField(rules, 'searchName')}
            />
          )}
          {step === 4 && (
            <StepCleanName
              name={productName}
              onNameChange={setProductName}
              rules={rulesForNameField(rules, 'searchName')}
              manualChecks={manualChecks}
              onManualCheckChange={(key, checked) =>
                setManualChecks((prev) => ({ ...prev, [key]: checked }))
              }
            />
          )}
          {step === 5 && (
            <StepResearch
              terms={terms}
              onAdd={addTerms}
              onRemove={(keyword) => setTerms((prev) => prev.filter((t) => t.keyword !== keyword))}
              adTerms={adTerms}
            />
          )}
          {step === 6 && (
            <StepClassify
              terms={terms}
              onTypeChange={(keyword, type) =>
                setTerms((prev) => prev.map((t) => (t.keyword === keyword ? { ...t, type } : t)))
              }
            />
          )}
          {step === 7 && (
            <StepDedupe
              keywords={finalKeywords}
              onKeywordsChange={setFinalKeywords}
              productName={productName}
              categoryNames={categoryNames}
              optionNames={optionNames}
              rules={rules}
              typeOf={typeOf}
            />
          )}
        </CardContent>
      </Card>

      {/* 단계 이동 · 저장 */}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-background/95 py-3 backdrop-blur">
        <Button
          type="button"
          variant="outline"
          onClick={() => goToStep(step - 1)}
          disabled={step === 0}
          className="gap-1"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          이전
        </Button>

        {step === 4 && !manualDone && (
          <span className="text-xs text-muted-foreground">
            직접 확인 항목을 모두 체크하면 다음 단계로 넘어갈 준비가 끝납니다.
          </span>
        )}
        {step === 3 && composeName(nameParts).length === 0 && productName.trim().length === 0 && (
          <span className="text-xs text-muted-foreground">
            조각을 채우고 조립하거나 상품명을 직접 입력해주세요.
          </span>
        )}
        {step === 1 && !canGoNext && (
          <span className="text-xs text-muted-foreground">메인 키워드를 1개 입력해주세요.</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isLast ? (
            <Button
              type="button"
              onClick={() => saveToListing()}
              disabled={!listing || saving}
              className="gap-1"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {keywordChange.changed ? '변경 사유 입력 후 반영' : '판매채널 상품에 반영'}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => goToStep(step + 1)}
              disabled={!canGoNext}
              className="gap-1"
            >
              다음
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {listing && (
        <KeywordChangeDialog
          open={gateOpen}
          onOpenChange={setGateOpen}
          beforeName={listing.searchName}
          afterName={productName.trim()}
          beforeKeywords={listing.keywords}
          afterKeywords={keywordsToSave}
          saving={saving}
          onConfirm={(meta) => saveToListing(meta)}
        />
      )}

      {isLast && !listing && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          판매채널 상품에서 진입하면 여기서 상품명과 검색어를 바로 반영할 수 있습니다.
        </p>
      )}
    </div>
  )
}
