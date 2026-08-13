'use client'

// §22 STEP 06 — 쿠팡 검색어 조사.
// 조사 순서(자동완성 → 연관검색어 → 상위 상품 → 고객 리뷰)를 출처로 기록해두면
// STEP 07 분류와 STEP 08 정리에서 근거가 남는다.

import { useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { KEYWORD_SOURCE_LABELS } from '@/lib/sh/keyword-labels'

import { RESEARCH_SOURCE_ORDER, type ResearchSource, type ResearchTerm } from './naming-sop-types'

export type AdTerm = {
  keyword: string
  impressions: number
  clicks: number
  roas: number | null
}

export type AdTermsState = {
  loading: boolean
  /** 광고 데이터 연동 여부. false 면 이 space 는 coupang-ads 를 쓰지 않는다. */
  linked: boolean
  data: AdTerm[]
  /** 상품을 특정할 수 없어 조회 자체를 하지 않은 경우 */
  skipped: boolean
}

type Props = {
  terms: ResearchTerm[]
  onAdd: (keywords: string[], source: ResearchSource) => void
  onRemove: (keyword: string) => void
  adTerms: AdTermsState
}

export function StepResearch({ terms, onAdd, onRemove, adTerms }: Props) {
  const [draft, setDraft] = useState('')
  const [source, setSource] = useState<ResearchSource>('COUPANG_AUTOCOMPLETE')

  const existing = new Set(terms.map((t) => t.keyword.toLowerCase()))

  function submitDraft() {
    const parsed = draft
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter(Boolean)
    if (parsed.length === 0) return
    onAdd(parsed, source)
    setDraft('')
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        쿠팡 자동완성 → 연관검색어 → 상위 상품 → 고객 리뷰 순서로 조사한 표현을 모읍니다. 판정은
        하지 않고 후보만 모으는 단계입니다.
      </p>

      <div className="space-y-2">
        <Label htmlFor="research-input">검색어 후보 입력</Label>
        <div className="flex flex-wrap gap-2">
          <Select value={source} onValueChange={(v) => setSource(v as ResearchSource)}>
            <SelectTrigger className="w-[160px]" aria-label="검색어 출처">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESEARCH_SOURCE_ORDER.map((key) => (
                <SelectItem key={key} value={key}>
                  {KEYWORD_SOURCE_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            id="research-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter') {
                e.preventDefault()
                submitDraft()
              }
            }}
            placeholder="검색어 입력 후 Enter (쉼표로 여러 개)"
            className="min-w-[200px] flex-1"
          />
          <Button type="button" variant="outline" onClick={submitDraft} className="gap-1">
            <Plus className="h-4 w-4" aria-hidden="true" />
            추가
          </Button>
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">
          수집한 후보 <span className="text-muted-foreground tabular-nums">{terms.length}개</span>
        </h3>
        {terms.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            아직 수집한 검색어가 없습니다.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {terms.map((term) => (
              <li key={term.keyword}>
                <Badge variant="secondary" className="gap-1 py-1 pr-1 pl-2 text-sm font-normal">
                  <span>{term.keyword}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {KEYWORD_SOURCE_LABELS[term.source]}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(term.keyword)}
                    aria-label={`검색어 ${term.keyword} 제거`}
                    className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">광고 검색어</h3>
        {adTerms.loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            불러오는 중...
          </p>
        ) : adTerms.skipped ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
            판매채널 상품에서 진입하면 해당 상품의 광고 검색어를 함께 볼 수 있습니다.
          </p>
        ) : !adTerms.linked || adTerms.data.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
            {adTerms.linked
              ? '이 상품에 연결된 광고 검색어가 없습니다.'
              : '연동된 광고 데이터가 없습니다.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>검색어</TableHead>
                  <TableHead className="text-right">노출</TableHead>
                  <TableHead className="text-right">클릭</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {adTerms.data.map((row) => {
                  const added = existing.has(row.keyword.toLowerCase())
                  return (
                    <TableRow key={row.keyword}>
                      <TableCell className="font-medium">{row.keyword}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.impressions.toLocaleString('ko-KR')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.clicks.toLocaleString('ko-KR')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.roas != null ? `${(row.roas * 100).toFixed(0)}%` : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={added}
                          onClick={() => onAdd([row.keyword], 'AD_KEYWORD')}
                        >
                          {added ? '추가됨' : '추가'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}
