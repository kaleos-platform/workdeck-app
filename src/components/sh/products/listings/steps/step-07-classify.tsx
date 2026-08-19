'use client'

// §22 STEP 07 — 검색어 후보를 §13 A~G 버킷에 배정한다.
//
// 라벨은 KEYWORD_TYPE_LABELS 에서만 가져온다(한국어 표기 하드코딩 금지).
// COMPETITOR 는 버킷으로 제공하지 않는다 — 분류가 아니라 배제 사유이고, 검증이 ERROR 로 잡는다.

import { Badge } from '@/components/ui/badge'
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
import { KEYWORD_SOURCE_LABELS, KEYWORD_TYPE_LABELS } from '@/lib/sh/keyword-labels'
import type { KeywordTypeKey } from '@/lib/sh/keyword-score'

import { CLASSIFY_BUCKETS, type ResearchTerm } from './naming-sop-types'

type Props = {
  terms: ResearchTerm[]
  onTypeChange: (keyword: string, type: KeywordTypeKey) => void
}

export function StepClassify({ terms, onTypeChange }: Props) {
  const counts = new Map<KeywordTypeKey, number>()
  for (const term of terms) counts.set(term.type, (counts.get(term.type) ?? 0) + 1)
  const unclassified = counts.get('UNCLASSIFIED') ?? 0

  if (terms.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
        분류할 검색어 후보가 없습니다. STEP 06 에서 후보를 먼저 모아주세요.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        후보를 유형별로 나눕니다. 유형이 한쪽에 몰려 있으면 다른 각도의 검색어가 빠졌다는 뜻입니다.
      </p>

      <div className="flex flex-wrap gap-1.5" aria-live="polite">
        {CLASSIFY_BUCKETS.map((bucket) => (
          <Badge key={bucket} variant={counts.get(bucket) ? 'secondary' : 'outline'}>
            {KEYWORD_TYPE_LABELS[bucket]} {counts.get(bucket) ?? 0}
          </Badge>
        ))}
        <Badge variant={unclassified > 0 ? 'outline' : 'secondary'}>
          {KEYWORD_TYPE_LABELS.UNCLASSIFIED} {unclassified}
        </Badge>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>검색어</TableHead>
              <TableHead className="w-36">출처</TableHead>
              <TableHead className="w-48">유형</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {terms.map((term) => (
              <TableRow key={term.keyword}>
                <TableCell className="font-medium">{term.keyword}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {KEYWORD_SOURCE_LABELS[term.source]}
                </TableCell>
                <TableCell>
                  <Select
                    value={term.type}
                    onValueChange={(v) => onTypeChange(term.keyword, v as KeywordTypeKey)}
                  >
                    <SelectTrigger className="h-8 w-full" aria-label={`${term.keyword} 유형 선택`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNCLASSIFIED">
                        {KEYWORD_TYPE_LABELS.UNCLASSIFIED}
                      </SelectItem>
                      {CLASSIFY_BUCKETS.map((bucket) => (
                        <SelectItem key={bucket} value={bucket}>
                          {KEYWORD_TYPE_LABELS[bucket]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
