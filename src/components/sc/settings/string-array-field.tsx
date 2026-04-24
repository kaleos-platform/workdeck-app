'use client'

import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

type Props = {
  id?: string
  label: string
  value: string[] | undefined
  onChange: (next: string[]) => void
  placeholder?: string
  rows?: number
  helpText?: string
}

/**
 * 줄 단위로 문자열 배열을 편집하는 간단한 textarea 필드.
 * 한 줄 = 하나의 항목. 빈 줄은 자동으로 제외된다.
 */
export function StringArrayField({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  helpText,
}: Props) {
  const text = (value ?? []).join('\n')
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={text}
        rows={rows}
        placeholder={placeholder ?? '한 줄에 하나씩 입력하세요'}
        onChange={(e) => {
          const lines = e.target.value
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 0)
          onChange(lines)
        }}
      />
      {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
    </div>
  )
}
