'use client'

// §22 STEP 04 — 상품명 생성.
// 템플릿: [브랜드] [핵심 특징] [메인 키워드] [서브 특징] [규격/수량]

import { Wand2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { KeywordRuleSet } from '@/lib/sh/keyword-rules'

import { NameLengthGauge } from './name-length-gauge'
import type { NameParts } from './naming-sop-types'

const PART_FIELDS: { key: keyof NameParts; label: string; hint: string }[] = [
  { key: 'brand', label: '브랜드', hint: 'Fact Sheet 브랜드' },
  { key: 'keyFeature', label: '핵심 특징', hint: 'Fact Sheet 핵심 특징' },
  { key: 'main', label: '메인 키워드', hint: 'STEP 02' },
  { key: 'subFeature', label: '서브 특징', hint: 'STEP 03' },
  { key: 'spec', label: '규격/수량', hint: 'Fact Sheet 규격·수량' },
]

/** 빈 조각은 건너뛰고 공백 하나로 잇는다. */
export function composeName(parts: NameParts): string {
  return PART_FIELDS.map(({ key }) => parts[key].trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

type Props = {
  parts: NameParts
  /** 조각 단위로 알려준다 — 위저드가 "사용자가 직접 고친 조각"을 구분해야 한다. */
  onPartChange: (key: keyof NameParts, value: string) => void
  name: string
  onNameChange: (next: string) => void
  rules: KeywordRuleSet
}

export function StepComposeName({ parts, onPartChange, name, onNameChange, rules }: Props) {
  const preview = composeName(parts)
  const dirty = preview.length > 0 && preview !== name.trim()

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        템플릿 순서대로 조각을 채운 뒤 조립합니다. 조립 후에는 상품명을 직접 다듬어도 됩니다.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PART_FIELDS.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`part-${field.key}`}>{field.label}</Label>
            <Input
              id={`part-${field.key}`}
              value={parts[field.key]}
              placeholder={field.hint}
              onChange={(e) => onPartChange(field.key, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="rounded-md border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground">
              [브랜드] [핵심 특징] [메인 키워드] [서브 특징] [규격/수량]
            </p>
            <p className="mt-1 text-sm break-all">
              {preview || '조각을 입력하면 미리보기가 표시됩니다'}
            </p>
          </div>
          <Button
            type="button"
            variant={dirty ? 'default' : 'outline'}
            size="sm"
            disabled={preview.length === 0}
            onClick={() => onNameChange(preview)}
            className="gap-1"
          >
            <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
            템플릿으로 조립
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="composed-name">상품명</Label>
        <Textarea
          id="composed-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          rows={2}
          placeholder="조립 버튼을 누르거나 직접 입력하세요"
        />
        <NameLengthGauge length={name.trim().length} rules={rules} />
      </div>
    </div>
  )
}
