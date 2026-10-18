'use client'

import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Radix Select 는 빈 문자열 value 를 허용하지 않는다.
const NONE = '__common__'

type Props = {
  id: string
  label: string
  value: string | null
  onChange: (brandId: string | null) => void
  noneLabel?: string
  disabled?: boolean
}

/** seller-hub 브랜드 선택. 브랜드가 하나도 없는 Space 에서는 아무것도 그리지 않는다(전부 공통). */
export function BrandSelect({
  id,
  label,
  value,
  onChange,
  noneLabel = '공통(브랜드 미지정)',
  disabled,
}: Props) {
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    let alive = true
    fetch('/api/sc/brands', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { brands: [] }))
      .then((json) => alive && setBrands(json.brands ?? []))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (brands.length === 0) return null

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
          {brands.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
