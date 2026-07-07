'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { FormFieldInput } from '@/lib/validations/hiring-posts'

type Props = {
  postingId: string
  initialFields: FormFieldInput[]
  onFieldsChange: (fields: FormFieldInput[]) => void
}

const CUSTOM_TYPE_LABELS: Record<string, string> = {
  string: '한 줄 텍스트',
  text: '여러 줄 텍스트',
  select: '선택 목록',
  file: '파일 첨부',
}

type CustomField = {
  key: string
  type: 'string' | 'text' | 'select' | 'file'
  label: string
  required: boolean
  optionsText: string
}

function makeKey(): string {
  return `custom_${Math.random().toString(36).slice(2, 9)}`
}

export function StepForm({ postingId, initialFields, onFieldsChange }: Props) {
  const [emailEnabled, setEmailEnabled] = useState(initialFields.some((f) => f.key === 'email'))
  const [addressEnabled, setAddressEnabled] = useState(
    initialFields.some((f) => f.key === 'address')
  )
  const [customFields, setCustomFields] = useState<CustomField[]>(
    initialFields
      .filter((f) => !['name', 'phone', 'email', 'address'].includes(f.key))
      .map((f) => ({
        key: f.key,
        type: (['string', 'text', 'select', 'file'].includes(f.type) ? f.type : 'string') as
          | 'string'
          | 'text'
          | 'select'
          | 'file',
        label: f.label,
        required: f.required,
        optionsText: (f.options ?? []).join(', '),
      }))
  )
  const [saving, setSaving] = useState(false)

  // 최종 폼 필드 배열 (표준 순서 → 커스텀)
  const fields = useMemo<FormFieldInput[]>(() => {
    const out: FormFieldInput[] = [
      { key: 'name', type: 'string', label: '이름', required: true },
      { key: 'phone', type: 'phone', label: '연락처', required: true },
    ]
    if (emailEnabled) out.push({ key: 'email', type: 'email', label: '이메일', required: false })
    if (addressEnabled) out.push({ key: 'address', type: 'string', label: '주소', required: false })
    for (const c of customFields) {
      out.push({
        key: c.key,
        type: c.type,
        label: c.label,
        required: c.required,
        ...(c.type === 'select'
          ? {
              options: c.optionsText
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean),
            }
          : {}),
      })
    }
    return out
  }, [emailEnabled, addressEnabled, customFields])

  function addCustom() {
    setCustomFields((prev) => [
      ...prev,
      { key: makeKey(), type: 'string', label: '', required: false, optionsText: '' },
    ])
  }
  function updateCustom(idx: number, patch: Partial<CustomField>) {
    setCustomFields((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }
  function removeCustom(idx: number) {
    setCustomFields((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    if (customFields.some((c) => !c.label.trim())) {
      toast.error('모든 커스텀 항목의 이름을 입력하세요')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/form`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      })
      if (!res.ok) throw new Error('폼 저장에 실패했습니다')
      onFieldsChange(fields)
      toast.success('지원서 폼을 저장했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '폼 저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* 편집 */}
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="text-sm font-medium">표준 항목</div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>이름 · 연락처</span>
              <span className="text-xs text-muted-foreground">필수 · 고정</span>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label htmlFor="email-toggle" className="text-sm">
                이메일
              </Label>
              <Switch id="email-toggle" checked={emailEnabled} onCheckedChange={setEmailEnabled} />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label htmlFor="addr-toggle" className="text-sm">
                주소
              </Label>
              <Switch
                id="addr-toggle"
                checked={addressEnabled}
                onCheckedChange={setAddressEnabled}
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">커스텀 항목</div>
            <Button size="sm" variant="outline" onClick={addCustom}>
              <Plus /> 항목 추가
            </Button>
          </div>
          <div className="space-y-3">
            {customFields.map((c, idx) => (
              <div key={c.key} className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="size-4 shrink-0 text-muted-foreground" />
                  <Input
                    value={c.label}
                    onChange={(e) => updateCustom(idx, { label: e.target.value })}
                    placeholder="항목 이름"
                    className="flex-1"
                  />
                  <Button size="icon-sm" variant="ghost" onClick={() => removeCustom(idx)}>
                    <Trash2 />
                  </Button>
                </div>
                <div className="flex items-center gap-2 pl-6">
                  <Select
                    value={c.type}
                    onValueChange={(v) => updateCustom(idx, { type: v as CustomField['type'] })}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CUSTOM_TYPE_LABELS).map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Switch
                      checked={c.required}
                      onCheckedChange={(v) => updateCustom(idx, { required: v })}
                    />
                    필수
                  </label>
                </div>
                {c.type === 'select' && (
                  <Input
                    value={c.optionsText}
                    onChange={(e) => updateCustom(idx, { optionsText: e.target.value })}
                    placeholder="선택지 (쉼표로 구분)"
                    className="ml-6 w-[calc(100%-1.5rem)]"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving}>
          폼 저장
        </Button>
      </div>

      {/* 미리보기 */}
      <div className="space-y-3 rounded-lg border p-4">
        <div className="text-sm font-medium text-muted-foreground">지원서 미리보기</div>
        <div className="space-y-3">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <div className="text-xs font-medium">
                {f.label}
                {f.required && <span className="ml-0.5 text-red-500">*</span>}
              </div>
              {f.type === 'text' ? (
                <div className="h-16 rounded-md border bg-muted/40" />
              ) : f.type === 'select' ? (
                <div className="h-9 rounded-md border bg-muted/40 px-2 text-xs leading-9 text-muted-foreground">
                  {(f.options ?? []).join(' / ') || '선택'}
                </div>
              ) : f.type === 'file' ? (
                <div className="h-9 rounded-md border border-dashed bg-muted/40 px-2 text-xs leading-9 text-muted-foreground">
                  파일 선택
                </div>
              ) : (
                <div className="h-9 rounded-md border bg-muted/40" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
