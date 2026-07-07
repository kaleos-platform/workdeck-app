'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { FormFieldInput } from '@/lib/validations/hiring-posts'

type Props = {
  title: string
  closingDate: string // 'YYYY-MM-DD' 또는 ''
  fields: FormFieldInput[]
}

// 공개 지원 폼 미리보기 — wizard 로컬 상태에서 즉시 렌더(모든 컨트롤 disabled).
export function ApplicationFormPreview({ title, closingDate, fields }: Props) {
  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">지원서 미리보기</div>
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-semibold">{title || '제목 없는 공고'}</h2>
            {closingDate && (
              <Badge variant="outline" className="shrink-0 text-muted-foreground">
                ~{closingDate} 마감
              </Badge>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {fields.map((f) => (
            <FieldPreview key={f.key} field={f} />
          ))}
        </div>

        <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Checkbox disabled className="mt-0.5" />
          <span>개인정보 수집·이용에 동의합니다. (필수)</span>
        </label>

        <Button className="w-full" disabled>
          지원하기
        </Button>
      </CardContent>
    </Card>
  )
}

function FieldPreview({ field }: { field: FormFieldInput }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">
        {field.label}
        {field.required && <span className="ml-0.5 text-red-500">*</span>}
      </div>
      {field.type === 'text' ? (
        <div className="h-16 rounded-md border bg-muted/40" />
      ) : field.type === 'select' ? (
        <div className="h-9 rounded-md border bg-muted/40 px-2 text-xs leading-9 text-muted-foreground">
          {(field.options ?? []).join(' / ') || '선택'}
        </div>
      ) : field.type === 'file' ? (
        <div className="h-9 rounded-md border border-dashed bg-muted/40 px-2 text-xs leading-9 text-muted-foreground">
          파일 선택
        </div>
      ) : (
        <div className="h-9 rounded-md border bg-muted/40" />
      )}
    </div>
  )
}
