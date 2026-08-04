'use client'

import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { MetricFilterBuilder } from '@/components/dashboard/metric-filter-builder'
import {
  PRESETS,
  describeConditions,
  parseConditions,
  serializeConditions,
  type MetricCondition,
} from '@/lib/coupang-ads/metric-filter'

export type FilterId = 'lowEff' | 'orders' | 'custom'

type Props = {
  /** localStorage 키 접미사 (전역, 캠페인 무관): 'keyword' | 'product' */
  scope: string
  lowEffLabel: string
  ordersLabel: string
  /** 적용 조건 변경 시(토글·편집·커스텀) 이벤트에서 호출 — 부모가 fetch/필터 구동. */
  onConditionsChange: (conds: MetricCondition[]) => void
  /** 활성 항목 변경 시(정렬 등 부수효과용). custom/null은 부모가 무시 가능. */
  onActivate?: (id: FilterId | null) => void
}

function loadDef(key: string, fallback: MetricCondition[]): MetricCondition[] {
  if (typeof window === 'undefined') return fallback
  const stored = localStorage.getItem(key)
  return stored ? parseConditions(stored) : fallback
}

/**
 * 3개 독립 필터 항목(저효율·주문발생·커스텀) 관리 바.
 *  - 저효율/주문발생: 편집 가능 임계값, 전역 localStorage 영속, seed=PRESETS.
 *  - 커스텀: 비영속(매번 새로).
 *  - 한 번에 하나만 활성(activeId). 적용 조건은 활성 항목의 정의.
 */
export function MetricFilterGroup({
  scope,
  lowEffLabel,
  ordersLabel,
  onConditionsChange,
  onActivate,
}: Props) {
  const lowEffKey = `coupang-ads:lowEff:${scope}`
  const ordersKey = `coupang-ads:orders:${scope}`

  // 전역 영속 정의 — lazy init(초기 페인트에 미노출이라 hydration mismatch 없음)
  const [lowEffDef, setLowEffDef] = useState<MetricCondition[]>(() =>
    loadDef(lowEffKey, PRESETS.zero)
  )
  const [ordersDef, setOrdersDef] = useState<MetricCondition[]>(() =>
    loadDef(ordersKey, PRESETS.orders)
  )
  const [customDef, setCustomDef] = useState<MetricCondition[]>([])
  const [activeId, setActiveId] = useState<FilterId | null>(null)

  useEffect(() => {
    localStorage.setItem(lowEffKey, serializeConditions(lowEffDef))
  }, [lowEffKey, lowEffDef])
  useEffect(() => {
    localStorage.setItem(ordersKey, serializeConditions(ordersDef))
  }, [ordersKey, ordersDef])

  const activeConds =
    activeId === 'lowEff'
      ? lowEffDef
      : activeId === 'orders'
        ? ordersDef
        : activeId === 'custom'
          ? customDef
          : []

  function togglePreset(id: 'lowEff' | 'orders', def: MetricCondition[]) {
    const next = activeId === id ? null : id
    setActiveId(next)
    onConditionsChange(next === id ? def : [])
    onActivate?.(next)
  }

  function savePreset(id: 'lowEff' | 'orders', conds: MetricCondition[]) {
    if (id === 'lowEff') setLowEffDef(conds)
    else setOrdersDef(conds)
    // 편집 중인 프리셋이 활성이면 즉시 재적용
    if (activeId === id) onConditionsChange(conds)
  }

  function applyCustom(conds: MetricCondition[]) {
    setCustomDef(conds)
    const next: FilterId | null = conds.length > 0 ? 'custom' : null
    setActiveId(next)
    onConditionsChange(conds)
    onActivate?.(next)
  }

  const presetBtn = (
    id: 'lowEff' | 'orders',
    label: string,
    def: MetricCondition[],
    seed: MetricCondition[]
  ) => (
    <div className="flex items-center">
      <Button
        variant={activeId === id ? 'default' : 'outline'}
        size="sm"
        className="h-7 rounded-r-none text-xs"
        onClick={() => togglePreset(id, def)}
      >
        {label}
      </Button>
      <MetricFilterBuilder
        value={def}
        onApply={(c) => savePreset(id, c)}
        resetTo={seed}
        title={`${label} 조건 편집`}
        trigger={
          <Button
            variant={activeId === id ? 'default' : 'outline'}
            size="icon"
            className="h-7 w-7 rounded-l-none border-l-0"
            aria-label={`${label} 조건 편집`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        }
      />
    </div>
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presetBtn('lowEff', lowEffLabel, lowEffDef, PRESETS.zero)}
      {presetBtn('orders', ordersLabel, ordersDef, PRESETS.orders)}
      <MetricFilterBuilder value={customDef} onApply={applyCustom} className="h-7 text-xs" />
      {activeConds.length > 0 && (
        <span className="text-xs text-muted-foreground">{describeConditions(activeConds)}</span>
      )}
    </div>
  )
}
