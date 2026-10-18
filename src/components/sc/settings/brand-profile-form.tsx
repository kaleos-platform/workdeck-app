'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StringArrayField } from './string-array-field'
import { CustomFieldsEditor, type CustomField } from '@/components/sc/shared/custom-fields-editor'
import { BrandSelect } from '@/components/sc/shared/brand-select'

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
  // null = Space 공통 프로필(초기값). 브랜드를 고르면 그 브랜드 프로필을 불러와 편집한다.
  const [brandId, setBrandId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  function update<K extends keyof BrandProfileFormState>(key: K, value: BrandProfileFormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  // 불러오기에 성공한 뒤에만 brandId 를 바꾼다. 먼저 바꾸면 실패 시 이전 브랜드 내용이 폼에 남은 채
  // 새 브랜드로 저장돼 덮어쓴다.
  async function selectBrand(next: string | null) {
    setMessage(null)
    setLoading(true)
    try {
      const qs = next ? `?brandId=${encodeURIComponent(next)}` : ''
      const res = await fetch(`/api/sc/brand-profile${qs}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('프로필을 불러오지 못했습니다')
      const { profile } = await res.json()
      setState(
        profile
          ? {
              companyName: profile.companyName ?? '',
              shortDescription: profile.shortDescription ?? '',
              toneOfVoice: profile.toneOfVoice ?? [],
              customFields: profile.customFields ?? [],
            }
          : EMPTY
      )
      setBrandId(next)
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setMessage(null)
    try {
      const cleanCustomFields = state.customFields.filter((f) => f.key.trim())
      const body = {
        companyName: state.companyName,
        shortDescription: state.shortDescription || undefined,
        toneOfVoice: state.toneOfVoice.length ? state.toneOfVoice : undefined,
        customFields: cleanCustomFields.length ? cleanCustomFields : undefined,
        brandId,
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
      <BrandSelect
        id="brandProfileBrand"
        label="편집할 브랜드"
        value={brandId}
        onChange={selectBrand}
        noneLabel="공통(브랜드를 정하지 않은 상품에 사용)"
        disabled={loading || submitting}
      />
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
        <Button type="submit" disabled={submitting || loading}>
          {submitting ? '저장 중…' : '저장'}
        </Button>
      </div>
    </form>
  )
}
