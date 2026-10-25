'use client'

import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { MAX_KEYWORDS } from '@/components/sh/products/listings/keyword-editor'
import { despaceKeyword } from '@/lib/sh/keyword-normalize'
import { formatCount, type AdPerformanceData } from './use-keyword-ad-performance'

/** 광고 검색어 기반 발굴·정리 후보. 추가는 편집기 목록(미저장)에만 반영한다. */
export function KeywordAdPanel({
  data,
  value,
  onChange,
  readOnly = false,
}: {
  data: AdPerformanceData | null
  value: string[]
  onChange: (next: string[]) => void
  readOnly?: boolean
}) {
  // 쿠팡 외 채널·광고 미연결 상품이 대부분이라 연결 없음은 표시하지 않는다.
  if (!data?.attributed) return null
  const have = new Set(value.map(despaceKeyword))
  const discover = data.discover.filter((d) => !have.has(d.word))
  const atMax = value.length >= MAX_KEYWORDS

  return (
    <div className="mt-3 space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
      <p className="text-muted-foreground">
        최근 30일 광고 기준{data.window && ` (${data.window.from} ~ ${data.window.to})`} · 광고를
        돌린 검색어만 집계됩니다.
      </p>
      {discover.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">발굴 후보 (주문이 났지만 상품명·키워드에 없는 단어)</p>
          <ul className="space-y-1">
            {discover.map((d) => (
              <li key={d.word} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{d.word}</span>
                <span className="text-muted-foreground">
                  주문 {d.orders} · 클릭 {formatCount(d.clicks)} · 예: {d.examples.join(', ')}
                </span>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={atMax}
                    onClick={() => onChange([...value, d.word])}
                    className="h-6 gap-1 px-2 text-xs"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    추가
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.prune.length > 0 && (
        <p>
          <span className="font-medium">정리 후보 (30일 노출 0)</span>{' '}
          <span className="text-muted-foreground">{data.prune.join(', ')}</span>
        </p>
      )}
    </div>
  )
}
