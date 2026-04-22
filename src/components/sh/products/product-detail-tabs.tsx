'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ProductBasicForm } from '@/components/sh/products/product-basic-form'
import { ProductOptionsTable } from '@/components/sh/products/product-options-table'
import { ProductionBatchTable } from '@/components/sh/products/production-batch-table'

type Props = {
  productId: string
}

const BASIC_FORM_ID = 'product-basic-form'

type SectionKey = 'basic' | 'options' | 'batches'

const SECTIONS: { key: SectionKey; label: string; title: string; description: string }[] = [
  {
    key: 'basic',
    label: '기본 정보',
    title: '기본 정보',
    description: '상품명·브랜드·제조사·특징·인증 등 상품 메타데이터',
  },
  {
    key: 'options',
    label: '옵션 + 가격',
    title: '옵션 + 가격',
    description: '사이즈·조합별 SKU와 원가/소비자가',
  },
  {
    key: 'batches',
    label: '생산 차수',
    title: '생산 차수',
    description: '옵션별 생산 배치와 단가 이력',
  },
]

/**
 * 상품 상세 — 세 섹션을 한 화면에 수직 배치하고 상단 sticky 네비게이션으로
 * 앵커 스크롤한다. 상단의 [저장] 버튼은 HTML native form attribute로 아래
 * ProductBasicForm을 제출한다.
 */
export function ProductDetailTabs({ productId }: Props) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [active, setActive] = useState<SectionKey>('basic')
  const [canSave, setCanSave] = useState(false)

  const sectionRefs = useRef<Record<SectionKey, HTMLElement | null>>({
    basic: null,
    options: null,
    batches: null,
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
          <Button type="submit" form={BASIC_FORM_ID} disabled={!canSave} size="sm">
            저장
          </Button>
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
        className="scroll-mt-24 space-y-4 border-t pt-8"
      >
        <SectionHeader title={SECTIONS[1].title} description={SECTIONS[1].description} />
        <ProductOptionsTable key={refreshKey} productId={productId} />
      </section>

      <section
        id="section-batches"
        data-section="batches"
        ref={(el) => {
          sectionRefs.current.batches = el
        }}
        className="scroll-mt-24 space-y-4 border-t pt-8"
      >
        <SectionHeader title={SECTIONS[2].title} description={SECTIONS[2].description} />
        <ProductionBatchTable productId={productId} />
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
