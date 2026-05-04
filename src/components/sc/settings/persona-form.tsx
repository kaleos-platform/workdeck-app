'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CustomFieldsEditor, type CustomField } from '@/components/sc/shared/custom-fields-editor'
import { SALES_CONTENT_PERSONAS_PATH } from '@/lib/deck-routes'

type Mode = 'create' | 'edit'

type PersonaFormState = {
  name: string
  jobTitle: string
  industry: string
  customFields: CustomField[]
  isActive: boolean
}

const EMPTY: PersonaFormState = {
  name: '',
  jobTitle: '',
  industry: '',
  customFields: [],
  isActive: true,
}

type Props = {
  mode: Mode
  personaId?: string
  initial?: Partial<PersonaFormState>
}

export function PersonaForm({ mode, personaId, initial }: Props) {
  const router = useRouter()
  const [state, setState] = useState<PersonaFormState>({ ...EMPTY, ...initial })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof PersonaFormState>(key: K, value: PersonaFormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const body = {
        name: state.name,
        jobTitle: state.jobTitle || undefined,
        industry: state.industry || undefined,
        customFields: state.customFields.length ? state.customFields : undefined,
        isActive: state.isActive,
      }

      const url = mode === 'create' ? '/api/sc/personas' : `/api/sc/personas/${personaId}`
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({ message: '저장 실패' }))
        throw new Error(json.message || '저장 실패')
      }
      router.push(SALES_CONTENT_PERSONAS_PATH)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function onDelete() {
    if (!personaId) return
    if (!confirm('정말로 이 페르소나를 삭제하시겠습니까?')) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/sc/personas/${personaId}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error('삭제 실패')
      router.push(SALES_CONTENT_PERSONAS_PATH)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="name">페르소나 이름 *</Label>
            <Input
              id="name"
              value={state.name}
              onChange={(e) => update('name', e.target.value)}
              required
              placeholder="예: 중견 제조사 디지털 전환 리드"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="jobTitle">직함</Label>
            <Input
              id="jobTitle"
              value={state.jobTitle}
              onChange={(e) => update('jobTitle', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="industry">산업</Label>
            <Input
              id="industry"
              value={state.industry}
              onChange={(e) => update('industry', e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Switch
              id="isActive"
              checked={state.isActive}
              onCheckedChange={(checked) => update('isActive', checked)}
            />
            <Label htmlFor="isActive" className="cursor-pointer">
              활성
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">커스텀 필드</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            AI 아이데이션에 추가로 전달할 페르소나 속성을 자유롭게 정의하세요 (예: 업무 목표, 고통
            포인트, 의사결정 역할 등).
          </p>
          <CustomFieldsEditor
            value={state.customFields}
            onChange={(v) => update('customFields', v)}
          />
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          {mode === 'edit' && (
            <Button type="button" variant="destructive" onClick={onDelete} disabled={submitting}>
              삭제
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(SALES_CONTENT_PERSONAS_PATH)}
            disabled={submitting}
          >
            취소
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
    </form>
  )
}
