'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StringArrayField } from './string-array-field'
import { CustomFieldsEditor, type CustomField } from '@/components/sc/shared/custom-fields-editor'

type BrandProfileFormState = {
  companyName: string
  shortDescription: string
  toneOfVoice: string[]
  customFields: CustomField[]
}

const EMPTY: BrandProfileFormState = {
  companyName: '',
  shortDescription: '',
  toneOfVoice: [],
  customFields: [],
}

type Props = {
  initial?: Partial<BrandProfileFormState>
}

export function BrandProfileForm({ initial }: Props) {
  const router = useRouter()
  const [state, setState] = useState<BrandProfileFormState>({ ...EMPTY, ...initial })
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  function update<K extends keyof BrandProfileFormState>(key: K, value: BrandProfileFormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setMessage(null)
    try {
      const body = {
        companyName: state.companyName,
        shortDescription: state.shortDescription || undefined,
        toneOfVoice: state.toneOfVoice.length ? state.toneOfVoice : undefined,
        customFields: state.customFields.length ? state.customFields : undefined,
      }
      const res = await fetch('/api/sc/brand-profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({ message: '저장 실패' }))
        throw new Error(json.message || '저장 실패')
      }
      setMessage({ kind: 'success', text: '저장되었습니다.' })
      router.refresh()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">회사 프로필</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="companyName">회사명 *</Label>
            <Input
              id="companyName"
              value={state.companyName}
              onChange={(e) => update('companyName', e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="shortDescription">한 줄 소개</Label>
            <Input
              id="shortDescription"
              value={state.shortDescription}
              onChange={(e) => update('shortDescription', e.target.value)}
              maxLength={400}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">보이스·톤</CardTitle>
        </CardHeader>
        <CardContent>
          <StringArrayField
            id="toneOfVoice"
            label="톤 키워드"
            value={state.toneOfVoice}
            onChange={(v) => update('toneOfVoice', v)}
            placeholder="예: 전문적, 간결한, 공감하는"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">커스텀 필드</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            AI 생성 시 추가로 반영할 브랜드 속성을 자유롭게 정의하세요 (예: 미션, 금칙어, 선호 표현
            등).
          </p>
          <CustomFieldsEditor
            value={state.customFields}
            onChange={(v) => update('customFields', v)}
          />
        </CardContent>
      </Card>

      {message && (
        <div
          className={`rounded-md border p-3 text-sm ${
            message.kind === 'error'
              ? 'border-destructive/40 bg-destructive/5 text-destructive'
              : 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? '저장 중…' : '저장'}
        </Button>
      </div>
    </form>
  )
}
