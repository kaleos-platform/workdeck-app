'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ProductBasicForm } from '@/components/sh/products/product-basic-form'
import { ProductAttributesEditor } from '@/components/sh/products/product-attributes-editor'
import { ProductOptionsTable } from '@/components/sh/products/product-options-table'
import { ProductListingsPanel } from '@/components/sh/products/listings/product-listings-panel'
import { ProductProductionRunsPanel } from '@/components/sh/products/production/product-production-runs-panel'

type Props = {
  productId: string
}

const BASIC_FORM_ID = 'product-basic-form'

type SectionKey = 'basic' | 'options' | 'production' | 'listings'

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
    description: '속성 조합별 관리코드(SKU)와 원가/소비자가',
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
]

/**
 * 상품 상세 — 세 섹션을 한 화면에 수직 배치하고 상단 sticky 네비게이션으로
 * 앵커 스크롤한다. 상단의 [저장] 버튼은 HTML native form attribute로 아래
 * ProductBasicForm을 제출한다.
 */
export function ProductDetailTabs({ productId }: Props) {
  const router = useRouter()
  const [refreshKey, setRefreshKey] = useState(0)
  const [active, setActive] = useState<SectionKey>('basic')
  const [canSave, setCanSave] = useState(false)
  const [duplicating, setDuplicating] = useState(false)

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
          <div className="flex items-center gap-2">
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
            <Button type="submit" form={BASIC_FORM_ID} disabled={!canSave} size="sm">
              저장
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
        <SectionHeader title={SECTIONS[0].title} description={SECTIONS[0].description} />
        <ProductBasicForm
          productId={productId}
          formId={BASIC_FORM_ID}
          hideInlineSaveButton
          onValidChange={setCanSave}
          onSaved={() => setRefreshKey((k) => k + 1)}
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
        <ProductAttributesEditor
          key={`attrs-${refreshKey}`}
          productId={productId}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
        <ProductOptionsTable
          key={`opts-${refreshKey}`}
          productId={productId}
          onChanged={() => setRefreshKey((k) => k + 1)}
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
    </div>
  )
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  )
}
