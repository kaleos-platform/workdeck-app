'use client'

// §22 STEP 08 — 중복 제거.
//
// 대조 축은 **상품명·카테고리·구매옵션 3개뿐이다.** 검색옵션(§20)은 이 위저드가 관리하는
// 데이터가 아니므로 대조하지 않고, 대조한 것처럼 보이는 문구도 넣지 않는다.

import { ListFilter } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { KEYWORD_TYPE_LABELS } from '@/lib/sh/keyword-labels'
import type { KeywordRuleSet } from '@/lib/sh/keyword-rules'
import { keywordPriority, type KeywordTypeKey } from '@/lib/sh/keyword-score'

import { KeywordEditor } from '../keyword-editor'
import { CLASSIFY_BUCKETS } from './naming-sop-types'

// §18 우선순위 안내 문구. keywordPriority 에서 파생시켜 정렬이 바뀌면 문구도 따라가게 한다.
const PRIORITY_HINT = [...CLASSIFY_BUCKETS]
  .sort((a, b) => keywordPriority(a) - keywordPriority(b))
  .map((t) => KEYWORD_TYPE_LABELS[t])
  .join(' → ')

type Props = {
  keywords: string[]
  onKeywordsChange: (next: string[]) => void
  productName: string
  categoryNames: string[]
  optionNames: string[]
  rules: KeywordRuleSet
  /** STEP 07 에서 배정한 유형 — §18 우선순위 절삭에 쓴다. */
  typeOf: (keyword: string) => KeywordTypeKey
}

export function StepDedupe({
  keywords,
  onKeywordsChange,
  productName,
  categoryNames,
  optionNames,
  rules,
  typeOf,
}: Props) {
  const filled = keywords.filter((k) => k.trim().length > 0)
  const overLimit = filled.length > rules.maxKeywords

  /**
   * §18 우선순위 절삭. validateKeywords 의 KW_OVER_LIMIT 은 입력 순서 기준이라
   * (keyword-validate.ts 주석대로) 유형 정보를 가진 호출부가 대신 처리한다.
   */
  function trimByPriority() {
    const ranked = filled
      .map((keyword, index) => ({ keyword, index, priority: keywordPriority(typeOf(keyword)) }))
      .sort((a, b) => a.priority - b.priority || a.index - b.index)
      .slice(0, rules.maxKeywords)
      .sort((a, b) => a.index - b.index)
      .map((r) => r.keyword)
    onKeywordsChange(ranked)
  }

  const axes: { label: string; values: string[] }[] = [
    { label: '상품명', values: productName.trim() ? [productName.trim()] : [] },
    { label: '카테고리', values: categoryNames },
    { label: '구매옵션', values: optionNames },
  ]

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        상품명·카테고리·구매옵션에 이미 들어있는 표현은 검색어에서 뺍니다. 특히{' '}
        <strong className="font-medium text-foreground">
          상품명에 있는 단어는 다시 넣지 않습니다.
        </strong>
      </p>

      <div className="rounded-md border bg-muted/30 p-4">
        <h3 className="text-sm font-medium">대조 기준</h3>
        <dl className="mt-2 space-y-1.5 text-sm">
          {axes.map((axis) => (
            <div key={axis.label} className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">{axis.label}</dt>
              <dd className="min-w-0 break-all">
                {axis.values.length > 0 ? (
                  axis.values.join(' · ')
                ) : (
                  <span className="text-muted-foreground">없음</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">최종 검색어</h3>
          {overLimit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={trimByPriority}
            >
              <ListFilter className="h-3 w-3" aria-hidden="true" />
              우선순위로 {rules.maxKeywords}개까지 정리
            </Button>
          )}
        </div>
        <KeywordEditor
          value={keywords}
          onChange={onKeywordsChange}
          productName={productName}
          categoryNames={categoryNames}
          optionNames={optionNames}
          rules={rules}
        />
        <p className="text-xs text-muted-foreground">우선순위 기준: {PRIORITY_HINT}</p>
      </div>
    </div>
  )
}
