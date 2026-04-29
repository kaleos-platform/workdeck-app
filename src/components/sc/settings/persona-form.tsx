'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StringArrayField } from './string-array-field'
import { SALES_CONTENT_PERSONAS_PATH } from '@/lib/deck-routes'

type Mode = 'create' | 'edit'

type PersonaFormState = {
  name: string
  slug: string
  jobTitle: string
  industry: string
  companySize: string
  seniority: string
  decisionRole: string
  goals: string[]
  painPoints: string[]
  objections: string[]
  preferredChannels: string[]
  toneHints: string
  isActive: boolean
}

const EMPTY: PersonaFormState = {
  name: '',
  slug: '',
  jobTitle: '',
  industry: '',
  companySize: '',
  seniority: '',
  decisionRole: '',
  goals: [],
  painPoints: [],
  objections: [],
  preferredChannels: [],
  toneHints: '',
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
        slug: state.slug,
        jobTitle: state.jobTitle || undefined,
        industry: state.industry || undefined,
        companySize: state.companySize || undefined,
        seniority: state.seniority || undefined,
        decisionRole: state.decisionRole || undefined,
        goals: state.goals.length ? state.goals : undefined,
        painPoints: state.painPoints.length ? state.painPoints : undefined,
        objections: state.objections.length ? state.objections : undefined,
        preferredChannels: state.preferredChannels.length ? state.preferredChannels : undefined,
        toneHints: state.toneHints || undefined,
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
            <Label htmlFor="slug">Slug *</Label>
            <Input
              id="slug"
              value={state.slug}
              onChange={(e) => update('slug', e.target.value)}
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="persona-slug"
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Switch
              id="isActive"
              checked={state.isActive}
              onCheckedChange={(checked) => update('isActive', checked)}
            />
            <Label htmlFor="isActive" className="cursor-pointer">
              활성
            </Label>
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
          <div className="space-y-1.5">
            <Label htmlFor="companySize">기업 규모</Label>
            <Input
              id="companySize"
              value={state.companySize}
              onChange={(e) => update('companySize', e.target.value)}
              placeholder="예: 중견 100~500명"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seniority">시니어리티</Label>
            <Input
              id="seniority"
              value={state.seniority}
              onChange={(e) => update('seniority', e.target.value)}
              placeholder="예: 임원, 매니저, 실무자"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="decisionRole">구매 의사결정 역할</Label>
            <Input
              id="decisionRole"
              value={state.decisionRole}
              onChange={(e) => update('decisionRole', e.target.value)}
              placeholder="예: 최종 결정자 / 인플루언서 / 유저"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">업무 맥락</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <StringArrayField
            id="goals"
            label="업무 목표"
            value={state.goals}
            onChange={(v) => update('goals', v)}
          />
          <StringArrayField
            id="painPoints"
            label="업무적 고통 포인트"
            value={state.painPoints}
            onChange={(v) => update('painPoints', v)}
          />
          <StringArrayField
            id="objections"
            label="구매 시 예상 반대 포인트"
            value={state.objections}
            onChange={(v) => update('objections', v)}
          />
          <StringArrayField
            id="preferredChannels"
            label="정보 수집 선호 채널"
            value={state.preferredChannels}
            onChange={(v) => update('preferredChannels', v)}
            placeholder="예: LinkedIn, 네이버 블로그, 업계 뉴스레터"
          />
          <div className="space-y-1.5">
            <Label htmlFor="toneHints">어울리는 톤 힌트</Label>
            <Textarea
              id="toneHints"
              value={state.toneHints}
              onChange={(e) => update('toneHints', e.target.value)}
              rows={2}
              placeholder="예: 데이터 기반, 신중하고 실용적인 표현 선호"
            />
          </div>
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
