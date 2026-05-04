'use client'

import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// KV 배열 인라인 편집 컴포넌트 — Product / Persona / BrandProfile 의 customFields 공용
export type CustomField = { key: string; value: string }

type Props = {
  value: CustomField[]
  onChange: (next: CustomField[]) => void
}

export function CustomFieldsEditor({ value, onChange }: Props) {
  function updateKey(i: number, key: string) {
    const next = value.map((f, idx) => (idx === i ? { ...f, key } : f))
    onChange(next)
  }

  function updateValue(i: number, val: string) {
    const next = value.map((f, idx) => (idx === i ? { ...f, value: val } : f))
    onChange(next)
  }

  function removeRow(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }

  function addRow() {
    onChange([...value, { key: '', value: '' }])
  }

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">커스텀 필드를 추가하세요</p>
      )}
      {value.map((field, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={field.key}
            onChange={(e) => updateKey(i, e.target.value)}
            placeholder="키"
            className="w-36 shrink-0"
          />
          <Input
            value={field.value}
            onChange={(e) => updateValue(i, e.target.value)}
            placeholder="값"
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => removeRow(i)}
            className="shrink-0"
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        + 필드 추가
      </Button>
    </div>
  )
}
