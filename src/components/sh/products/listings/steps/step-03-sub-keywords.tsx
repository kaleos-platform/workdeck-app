'use client'

// §22 STEP 03 — 서브 키워드 후보 3개.

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import type { FactSheet } from './naming-sop-types'

type Props = {
  value: string[]
  onChange: (next: string[]) => void
  factSheet: FactSheet
}

export function StepSubKeywords({ value, onChange, factSheet }: Props) {
  // §6 서브 키워드 유형(소재·형태·용도·대상·특징)에 대응하는 Fact Sheet 값.
  const candidates = [
    factSheet.material,
    factSheet.keyFeature,
    factSheet.purpose,
    factSheet.target,
    factSheet.spec,
  ]
    .map((v) => v.trim())
    .filter((v, i, arr) => v.length > 0 && arr.indexOf(v) === i)
    .filter((v) => !value.some((cur) => cur.trim() === v))

  function setAt(index: number, next: string) {
    onChange(value.map((v, i) => (i === index ? next : v)))
  }

  function fillFirstEmpty(keyword: string) {
    const idx = value.findIndex((v) => v.trim().length === 0)
    if (idx === -1) return
    setAt(idx, keyword)
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        상품명에 함께 넣을 보조 표현 3개를 적습니다. 소재·형태·용도·대상·특징 중에서 고릅니다.
      </p>

      <div className="max-w-md space-y-3">
        {value.map((v, idx) => (
          <div key={idx} className="space-y-1.5">
            <Label htmlFor={`sub-keyword-${idx}`}>서브 키워드 {idx + 1}</Label>
            <Input
              id={`sub-keyword-${idx}`}
              value={v}
              onChange={(e) => setAt(idx, e.target.value)}
              placeholder={idx === 0 ? '예: 코마사' : idx === 1 ? '예: 호텔' : '예: 대형'}
            />
          </div>
        ))}
      </div>

      {candidates.length > 0 && value.some((v) => v.trim().length === 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Fact Sheet 후보:</span>
          {candidates.map((c) => (
            <Button
              key={c}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => fillFirstEmpty(c)}
            >
              {c}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
