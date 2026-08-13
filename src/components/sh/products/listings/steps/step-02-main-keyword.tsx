'use client'

// §22 STEP 02 — 메인 키워드 **1개** 선정. 가이드가 1개로 못박았으므로 복수 선택을 두지 않는다.

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import type { FactSheet } from './naming-sop-types'

type Props = {
  value: string
  onChange: (next: string) => void
  factSheet: FactSheet
}

export function StepMainKeyword({ value, onChange, factSheet }: Props) {
  // Fact Sheet 에서 메인 키워드가 될 만한 후보 — 상품유형·상품군 순(§5 "가장 보편적인 상품명").
  const candidates = [factSheet.productType, factSheet.productGroup]
    .map((v) => v.trim())
    .filter((v, i, arr) => v.length > 0 && arr.indexOf(v) === i)

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        고객이 가장 보편적으로 사용하는 상품 이름{' '}
        <strong className="font-medium text-foreground">한 개</strong>를 고릅니다. 상품명의 중심이
        되는 단어입니다.
      </p>

      <div className="max-w-md space-y-1.5">
        <Label htmlFor="main-keyword">메인 키워드</Label>
        <Input
          id="main-keyword"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="예: 타월"
          aria-describedby="main-keyword-help"
        />
        <p id="main-keyword-help" className="text-xs text-muted-foreground">
          한 개만 입력합니다. 여러 표현이 고민되면 서브 키워드(STEP 03)로 넘깁니다.
        </p>
      </div>

      {candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Fact Sheet 후보:</span>
          {candidates.map((c) => (
            <Button
              key={c}
              type="button"
              variant={value.trim() === c ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onChange(c)}
            >
              {c}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
