'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StringArrayField } from './string-array-field'

type BrandProfileFormState = {
  companyName: string
  shortDescription: string
  missionStatement: string
  toneOfVoice: string[]
  forbiddenPhrases: string[]
  preferredPhrases: string[]
  styleGuideUrl: string
  primaryColor: string
  secondaryColor: string
  logoUrl: string
}

const EMPTY: BrandProfileFormState = {
  companyName: '',
  shortDescription: '',
  missionStatement: '',
  toneOfVoice: [],
  forbiddenPhrases: [],
  preferredPhrases: [],
  styleGuideUrl: '',
  primaryColor: '',
  secondaryColor: '',
  logoUrl: '',
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
        missionStatement: state.missionStatement || undefined,
        toneOfVoice: state.toneOfVoice.length ? state.toneOfVoice : undefined,
        forbiddenPhrases: state.forbiddenPhrases.length ? state.forbiddenPhrases : undefined,
        preferredPhrases: state.preferredPhrases.length ? state.preferredPhrases : undefined,
        styleGuideUrl: state.styleGuideUrl || undefined,
        primaryColor: state.primaryColor || undefined,
        secondaryColor: state.secondaryColor || undefined,
        logoUrl: state.logoUrl || undefined,
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
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="missionStatement">미션·비전</Label>
            <Textarea
              id="missionStatement"
              value={state.missionStatement}
              onChange={(e) => update('missionStatement', e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">보이스·톤</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <StringArrayField
            id="toneOfVoice"
            label="톤 키워드"
            value={state.toneOfVoice}
            onChange={(v) => update('toneOfVoice', v)}
            placeholder="예: 전문적, 간결한, 공감하는"
          />
          <StringArrayField
            id="preferredPhrases"
            label="선호 표현"
            value={state.preferredPhrases}
            onChange={(v) => update('preferredPhrases', v)}
            helpText="AI가 가급적 포함하거나 흉내낼 표현"
          />
          <StringArrayField
            id="forbiddenPhrases"
            label="금칙 표현"
            value={state.forbiddenPhrases}
            onChange={(v) => update('forbiddenPhrases', v)}
            helpText="AI가 사용하지 말아야 할 표현·단어"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">비주얼</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="primaryColor">주 색상 (HEX)</Label>
            <Input
              id="primaryColor"
              value={state.primaryColor}
              onChange={(e) => update('primaryColor', e.target.value)}
              placeholder="#1E40AF"
              pattern="#[0-9a-fA-F]{6}"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="secondaryColor">보조 색상 (HEX)</Label>
            <Input
              id="secondaryColor"
              value={state.secondaryColor}
              onChange={(e) => update('secondaryColor', e.target.value)}
              placeholder="#F59E0B"
              pattern="#[0-9a-fA-F]{6}"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="logoUrl">로고 URL</Label>
            <Input
              id="logoUrl"
              type="url"
              value={state.logoUrl}
              onChange={(e) => update('logoUrl', e.target.value)}
              placeholder="https://"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="styleGuideUrl">스타일 가이드 URL</Label>
            <Input
              id="styleGuideUrl"
              type="url"
              value={state.styleGuideUrl}
              onChange={(e) => update('styleGuideUrl', e.target.value)}
              placeholder="https://"
            />
          </div>
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
