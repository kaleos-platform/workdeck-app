'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Copy, Loader2, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  SELLER_HUB_PRICING_SIM_NEW_PATH,
  SELLER_HUB_PRODUCTS_LIST_PATH,
  getSellerHubPricingScenarioPath,
} from '@/lib/deck-routes'
import {
  ProductBasicForm,
  type ProductApplyPatch,
} from '@/components/sh/products/product-basic-form'
import { ProductExtractPanel } from '@/components/sh/products/extract/product-extract-panel'
import { ProductCodeField } from '@/components/sh/products/product-code-field'
import { ProductAttributesEditor } from '@/components/sh/products/product-attributes-editor'
import { ProductOptionsTable } from '@/components/sh/products/product-options-table'
import { ProductListingsPanel } from '@/components/sh/products/listings/product-listings-panel'
import { ProductProductionRunsPanel } from '@/components/sh/products/production/product-production-runs-panel'
import { PricingScenarioHistoryPanel } from '@/components/sh/products/pricing-sim/pricing-scenario-history-panel'
import { SaveStatusChip } from '@/components/sh/save-status-chip'

type Props = {
  productId: string
}

type SectionKey = 'basic' | 'options' | 'production' | 'listings' | 'pricing'

const SECTIONS: { key: SectionKey; label: string; title: string; description: string }[] = [
  {
    key: 'basic',
    label: '기본 정보',
    title: '기본 정보',
    description: '상품명·브랜드·제조사·특징·인증 등 상품 메타데이터',
  },
  {
    key: 'options',
    label: '옵션 관리',
    title: '옵션 관리',
    description: '제품코드·속성 조합별 관리코드(SKU)와 원가/소비자가',
  },
  {
    key: 'production',
    label: '생산 차수',
    title: '생산 차수',
    description: '이 상품의 옵션이 포함된 발주(생산) 차수 목록',
  },
  {
    key: 'listings',
    label: '판매채널 현황',
    title: '판매채널 현황',
    description: '이 상품이 등록된 판매채널 상품 목록',
  },
  {
    key: 'pricing',
    label: '가격 시나리오',
    title: '가격 시나리오 내역',
    description: '이 상품이 포함된 저장된 가격 시뮬레이션 시나리오',
  },
]

/**
 * 상품 상세 — 세 섹션을 한 화면에 수직 배치하고 상단 sticky 네비게이션으로
 * 앵커 스크롤한다. 상단의 [저장] 버튼은 HTML native form attribute로 아래
 * ProductBasicForm을 제출한다.
 */
export function ProductDetailTabs({ productId }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [refreshKey, setRefreshKey] = useState(0)
  const [active, setActive] = useState<SectionKey>('basic')
  const [duplicating, setDuplicating] = useState(false)
  // 자동 저장 상태 — BasicForm + CodeField + OptionsTable 합산.
  // 세 컴포넌트가 각자 콜백으로 값을 통째로 덮어쓰므로 채널을 분리해야 한다.
  const [basicDirty, setBasicDirty] = useState(0)
  const [basicSaving, setBasicSaving] = useState(false)
  const [codeDirty, setCodeDirty] = useState(0)
  const [codeSaving, setCodeSaving] = useState(false)
  const [optionsDirty, setOptionsDirty] = useState(0)
  const [optionsSaving, setOptionsSaving] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const basicRetryRef = useRef<(() => void) | null>(null)
  const codeRetryRef = useRef<(() => void) | null>(null)
  const optionsRetryRef = useRef<(() => void) | null>(null)
  // AI 추출 패널이 기본 정보 폼 state에 직접 값을 주입할 수 있는 핸들
  const basicApplyRef = useRef<((patch: ProductApplyPatch) => Promise<void>) | null>(null)
  // basicSaving은 autosave 진행 여부만 나타내 dirty(입력 직후)인 순간을 못 잡는다 —
  // 적용 버튼은 dirty 상태에서도 눌러선 안 되므로 둘을 합쳐 노출한다.
  const basicBusy = basicSaving || basicDirty > 0

  // AI 상품정보 추출은 고정 섹션이 아니라 다이얼로그다. `/extract` 딥링크(위 리다이렉트
  // 페이지)가 `?extract=1`을 붙여 진입시키므로 초기값을 쿼리에서 읽는다.
  const [extractOpen, setExtractOpen] = useState(() => searchParams.get('extract') === '1')

  const closeExtract = useCallback(() => {
    setExtractOpen(false)
    if (searchParams.get('extract') === '1') {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('extract')
      const qs = params.toString()
      router.replace(`/d/seller-ops/products/${productId}${qs ? `?${qs}` : ''}`, {
        scroll: false,
      })
    }
  }, [productId, router, searchParams])

  const dirtyCount = basicDirty + codeDirty + optionsDirty
  const saving = basicSaving || codeSaving || optionsSaving
  const handleRetry = useCallback(() => {
    setLastError(null)
    basicRetryRef.current?.()
    codeRetryRef.current?.()
    optionsRetryRef.current?.()
  }, [])

  // 제품코드가 바뀌면 SKU 자동 생성 결과가 달라지므로 옵션 관련 컴포넌트를 리마운트한다.
  // 단, 옵션 테이블에 미저장 draft가 있으면 리마운트가 그 편집을 버리므로 보류.
  const handleCodeSaved = useCallback(() => {
    if (optionsDirty > 0) return
    setRefreshKey((k) => k + 1)
  }, [optionsDirty])

  const handleDuplicate = useCallback(async () => {
    if (!confirm('이 상품을 복제하시겠습니까? 새 상품으로 이동합니다.')) return
    setDuplicating(true)
    try {
      const res = await fetch(`/api/sh/products/${productId}/duplicate`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '상품 복제 실패')
      const newId = data?.product?.id as string | undefined
      if (!newId) throw new Error('새 상품 ID를 받지 못했습니다')
      toast.success('상품이 복제되었습니다')
      router.push(`/d/seller-ops/products/${newId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '상품 복제 실패')
      setDuplicating(false)
    }
  }, [productId, router])

  const sectionRefs = useRef<Record<SectionKey, HTMLElement | null>>({
    basic: null,
    options: null,
    production: null,
    listings: null,
    pricing: null,
  })

  const goto = useCallback((key: SectionKey) => {
    const el = sectionRefs.current[key]
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(key)
  }, [])

  // 스크롤 위치에 따라 현재 섹션을 active로 반영
  useEffect(() => {
    const observed: HTMLElement[] = []
    const observer = new IntersectionObserver(
      (entries) => {
        // 현재 viewport 상단에 가장 가까운 section을 active로 선택
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const top = visible[0]
        if (!top) return
        const key = top.target.getAttribute('data-section') as SectionKey | null
        if (key) setActive(key)
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0 }
    )

    for (const { key } of SECTIONS) {
      const el = sectionRefs.current[key]
      if (el) {
        observer.observe(el)
        observed.push(el)
      }
    }

    return () => observer.disconnect()
  }, [])

  return (
    <div className="space-y-8">
      <header className="sticky top-0 z-20 -mx-8 border-b bg-background/95 px-8 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground"
            >
              <Link href={SELLER_HUB_PRODUCTS_LIST_PATH}>
                <ArrowLeft className="h-4 w-4" /> 상품 목록
              </Link>
            </Button>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
            <nav className="flex gap-1" aria-label="상품 상세 섹션">
              {SECTIONS.map((s) => (
                <Button
                  key={s.key}
                  variant="ghost"
                  size="sm"
                  onClick={() => goto(s.key)}
                  className={cn(
                    'transition-colors',
                    active === s.key
                      ? 'bg-muted font-semibold text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  aria-current={active === s.key ? 'true' : undefined}
                >
                  {s.label}
                </Button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <SaveStatusChip
              saving={saving}
              dirty={dirtyCount > 0}
              dirtyCount={dirtyCount}
              error={lastError}
              retryCount={0}
              onRetry={handleRetry}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDuplicate}
              disabled={duplicating}
            >
              {duplicating ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Copy className="mr-1 h-3 w-3" />
              )}
              복제
            </Button>
          </div>
        </div>
      </header>

      <section
        id="section-basic"
        data-section="basic"
        ref={(el) => {
          sectionRefs.current.basic = el
        }}
        className="scroll-mt-24 space-y-4"
      >
        <SectionHeader
          title={SECTIONS[0].title}
          description={SECTIONS[0].description}
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => setExtractOpen(true)}>
              <Sparkles className="mr-1 h-4 w-4" />
              AI로 채우기
            </Button>
          }
        />
        <ProductBasicForm
          productId={productId}
          onSaved={() => setRefreshKey((k) => k + 1)}
          onDirtyChange={setBasicDirty}
          onSavingChange={setBasicSaving}
          onError={setLastError}
          onRetryRefAvailable={(fn) => {
            basicRetryRef.current = fn
          }}
          onApplyRefAvailable={(fn) => {
            basicApplyRef.current = fn
          }}
        />
      </section>

      <section
        id="section-options"
        data-section="options"
        ref={(el) => {
          sectionRefs.current.options = el
        }}
        className="scroll-mt-24 space-y-6 border-t pt-8"
      >
        <SectionHeader title={SECTIONS[1].title} description={SECTIONS[1].description} />
        {/* refreshKey로 리마운트하지 않는다 — 다른 섹션 저장이 입력 중인 제품코드를 날리면 안 됨 */}
        <ProductCodeField
          productId={productId}
          onSaved={handleCodeSaved}
          onDirtyChange={setCodeDirty}
          onSavingChange={setCodeSaving}
          onError={setLastError}
          onRetryRefAvailable={(fn) => {
            codeRetryRef.current = fn
          }}
        />
        <ProductAttributesEditor
          key={`attrs-${refreshKey}`}
          productId={productId}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
        <ProductOptionsTable
          key={`opts-${refreshKey}`}
          productId={productId}
          onChanged={() => setRefreshKey((k) => k + 1)}
          onDirtyChange={setOptionsDirty}
          onSavingChange={setOptionsSaving}
          onError={setLastError}
          onRetryRefAvailable={(fn) => {
            optionsRetryRef.current = fn
          }}
        />
      </section>

      <section
        id="section-production"
        data-section="production"
        ref={(el) => {
          sectionRefs.current.production = el
        }}
        className="scroll-mt-24 space-y-4 border-t pt-8"
      >
        <SectionHeader title={SECTIONS[2].title} description={SECTIONS[2].description} />
        <ProductProductionRunsPanel key={`production-${refreshKey}`} productId={productId} />
      </section>

      <section
        id="section-listings"
        data-section="listings"
        ref={(el) => {
          sectionRefs.current.listings = el
        }}
        className="scroll-mt-24 space-y-4 border-t pt-8"
      >
        <SectionHeader title={SECTIONS[3].title} description={SECTIONS[3].description} />
        <ProductListingsPanel key={`listings-${refreshKey}`} productId={productId} />
      </section>

      <section
        id="section-pricing"
        data-section="pricing"
        ref={(el) => {
          sectionRefs.current.pricing = el
        }}
        className="scroll-mt-24 space-y-4 border-t pt-8"
      >
        <SectionHeader
          title={SECTIONS[4].title}
          description={SECTIONS[4].description}
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href={`${SELLER_HUB_PRICING_SIM_NEW_PATH}?productId=${productId}`}>
                <Plus className="mr-1 h-4 w-4" />
                가격 시나리오 생성
              </Link>
            </Button>
          }
        />
        <PricingScenarioHistoryPanel
          productId={productId}
          onRowClick={(id) => router.push(getSellerHubPricingScenarioPath(id))}
        />
      </section>

      <Dialog
        open={extractOpen}
        onOpenChange={(open) => {
          if (open) setExtractOpen(true)
          else closeExtract()
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>AI 상품정보 추출</DialogTitle>
            <DialogDescription>
              상세페이지 URL·이미지·PDF에서 설명·특징·인증정보를 추출해 기본 정보에 반영합니다
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <ProductExtractPanel
              productId={productId}
              basicBusy={basicBusy}
              onApply={(patch) => {
                if (!basicApplyRef.current) {
                  return Promise.reject(new Error('기본 정보 폼이 아직 준비되지 않았습니다'))
                }
                return basicApplyRef.current(patch)
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
