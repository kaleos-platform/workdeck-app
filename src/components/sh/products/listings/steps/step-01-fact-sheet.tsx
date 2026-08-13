'use client'

// §22 STEP 01 — 상품 Fact Sheet 작성.
//
// 여기서 입력한 값은 **위저드 안에서만** 쓴다. 상품 마스터에 되쓰지 않는다
// (상품 Fact Sheet 전용 컬럼이 없어 억지 매핑이 되기 때문).

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FACT_SHEET_FIELDS, type FactSheet } from './naming-sop-types'

/** 상품 마스터에서 읽어온 참고 정보 — 자유 입력을 돕는 힌트일 뿐 강제 매핑하지 않는다. */
export type ProductHints = {
  nameEn: string | null
  manufacturer: string | null
  manufactureCountry: string | null
  msrp: number | null
  features: string[]
  certifications: string[]
}

type Props = {
  value: FactSheet
  onChange: (next: FactSheet) => void
  hints: ProductHints | null
  productName: string | null
}

export function StepFactSheet({ value, onChange, hints, productName }: Props) {
  const hintRows: { label: string; text: string }[] = []
  if (hints) {
    if (hints.nameEn) hintRows.push({ label: '영문명', text: hints.nameEn })
    if (hints.manufacturer) hintRows.push({ label: '제조사', text: hints.manufacturer })
    if (hints.manufactureCountry) hintRows.push({ label: '제조국', text: hints.manufactureCountry })
    if (hints.msrp != null)
      hintRows.push({ label: '권장소비자가', text: `${hints.msrp.toLocaleString('ko-KR')}원` })
    if (hints.features.length > 0) hintRows.push({ label: '특징', text: hints.features.join(', ') })
    if (hints.certifications.length > 0)
      hintRows.push({ label: '인증', text: hints.certifications.join(', ') })
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        상품에 <strong className="font-medium text-foreground">실제로 해당되는 정보만</strong>{' '}
        적습니다. 여기 적은 내용은 위저드 안에서만 쓰이고 상품 정보에는 반영되지 않습니다.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {FACT_SHEET_FIELDS.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor={`fact-${field.key}`}>{field.label}</Label>
              {field.prefilled && value[field.key].trim().length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal">
                  상품 정보에서 채움
                </Badge>
              )}
            </div>
            <Input
              id={`fact-${field.key}`}
              value={value[field.key]}
              placeholder={field.placeholder}
              onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
            />
          </div>
        ))}
      </div>

      {(productName || hintRows.length > 0) && (
        <div className="rounded-md border bg-muted/30 p-4">
          <h3 className="text-sm font-medium">상품 정보 참고</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            소재·용도·대상은 상품 정보에 전용 항목이 없어 자동으로 채우지 않습니다. 아래 값을 보고
            직접 입력해주세요.
          </p>
          <dl className="mt-3 space-y-1.5 text-sm">
            {productName && (
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">현재 상품명</dt>
                <dd className="break-all">{productName}</dd>
              </div>
            )}
            {hintRows.map((row) => (
              <div key={row.label} className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">{row.label}</dt>
                <dd className="break-all">{row.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}
