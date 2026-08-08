'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Sparkles, X } from 'lucide-react'
import type { BrandProfileData, OnboardingDraft } from './types'

const MAX_TONE = 3

type Props = {
  initial: BrandProfileData | null
  draft: OnboardingDraft | null
  onSaved: (data: BrandProfileData) => void
}

// AI 제안 배지 — 값이 다를 때만 표시, 클릭하면 해당 값 적용
function SuggestionBadge({ suggestion, onApply }: { suggestion: string; onApply: () => void }) {
  return (
    <button type="button" onClick={onApply} className="mt-1 inline-block text-left">
      <Badge
        variant="outline"
        className="max-w-full cursor-pointer gap-1 border-fuchsia-400/50 text-fuchsia-700 hover:bg-fuchsia-50 dark:text-fuchsia-300 dark:hover:bg-fuchsia-950/30"
      >
        <Sparkles className="h-3 w-3 shrink-0" />
        <span className="truncate">AI 제안: {suggestion}</span>
      </Badge>
    </button>
  )
}

export function StepBrand({ initial, draft, onSaved }: Props) {
  const [companyName, setCompanyName] = useState(
    initial?.companyName || draft?.brandProfile.companyName || ''
  )
  const [shortDescription, setShortDescription] = useState(
    initial?.shortDescription || draft?.brandProfile.shortDescription || ''
  )
  const [toneOfVoice, setToneOfVoice] = useState<string[]>(
    initial?.toneOfVoice?.length ? initial.toneOfVoice : (draft?.brandProfile.toneOfVoice ?? [])
  )
  const [toneInput, setToneInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 기존 값이 있는 상태에서만 AI 제안을 다른 값으로 병기
  const draftCompanyName = draft?.brandProfile.companyName
  const draftShortDescription = draft?.brandProfile.shortDescription
  const draftTone = draft?.brandProfile.toneOfVoice

  const showCompanySuggestion =
    initial != null && draftCompanyName && draftCompanyName !== companyName
  const showDescSuggestion =
    initial != null && draftShortDescription && draftShortDescription !== shortDescription
  const showToneSuggestion =
    initial != null &&
    draftTone &&
    draftTone.length > 0 &&
    JSON.stringify(draftTone) !== JSON.stringify(toneOfVoice)

  function addTone() {
    const trimmed = toneInput.trim()
    if (!trimmed || toneOfVoice.length >= MAX_TONE || toneOfVoice.includes(trimmed)) return
    setToneOfVoice([...toneOfVoice, trimmed])
    setToneInput('')
  }

  function removeTone(v: string) {
    setToneOfVoice(toneOfVoice.filter((t) => t !== v))
  }

  async function save() {
    if (!companyName.trim()) {
      toast.error('회사명을 입력하세요')
      return
    }
    setSubmitting(true)
    try {
      const body = {
        companyName: companyName.trim(),
        shortDescription: shortDescription.trim() || undefined,
        toneOfVoice: toneOfVoice.length ? toneOfVoice : undefined,
      }
      const res = await fetch('/api/sc/brand-profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || '저장 실패')
      toast.success('브랜드 프로필을 저장했습니다.')
      onSaved({ companyName: companyName.trim(), shortDescription: shortDescription.trim(), toneOfVoice })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">브랜드 프로필</h2>
        <p className="text-sm text-muted-foreground">
          AI 초안이 있다면 자동으로 채워드립니다. 필요한 부분만 수정 후 저장하세요.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">회사 프로필</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="onb-companyName">회사명 *</Label>
            <Input
              id="onb-companyName"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              maxLength={200}
            />
            {showCompanySuggestion && draftCompanyName && (
              <SuggestionBadge
                suggestion={draftCompanyName}
                onApply={() => setCompanyName(draftCompanyName)}
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onb-shortDescription">한 줄 소개</Label>
            <Input
              id="onb-shortDescription"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              maxLength={400}
            />
            {showDescSuggestion && draftShortDescription && (
              <SuggestionBadge
                suggestion={draftShortDescription}
                onApply={() => setShortDescription(draftShortDescription)}
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">보이스·톤 (최대 {MAX_TONE}개)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {toneOfVoice.map((t) => (
              <Badge key={t} variant="secondary" className="gap-1">
                {t}
                <button type="button" onClick={() => removeTone(t)} aria-label={`${t} 제거`}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={toneInput}
              onChange={(e) => setToneInput(e.target.value)}
              placeholder="예: 전문적, 간결한, 공감하는"
              disabled={toneOfVoice.length >= MAX_TONE}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTone()
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={addTone}
              disabled={toneOfVoice.length >= MAX_TONE || !toneInput.trim()}
            >
              추가
            </Button>
          </div>
          {showToneSuggestion && draftTone && (
            <SuggestionBadge
              suggestion={draftTone.join(', ')}
              onApply={() => setToneOfVoice(draftTone.slice(0, MAX_TONE))}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="button" onClick={save} disabled={submitting}>
          {submitting ? '저장 중…' : '저장하고 다음'}
        </Button>
      </div>
    </div>
  )
}
