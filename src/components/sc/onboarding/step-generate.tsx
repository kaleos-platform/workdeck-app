'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sparkles, Loader2, CheckCircle2, RefreshCw } from 'lucide-react'
import type { OnboardingDraft, OnboardingResourceData } from './types'

type Props = {
  resources: OnboardingResourceData[]
  draft: OnboardingDraft | null
  draftStatus: string | null
  onGenerated: (draft: OnboardingDraft) => void
}

export function StepGenerate({ resources, draft, draftStatus, onGenerated }: Props) {
  const [generating, setGenerating] = useState(false)

  const extractableCount = resources.filter((r) => r.status === 'DONE').length
  const hasDraft = draft != null && draftStatus === 'READY'

  async function generate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/sc/onboarding/generate', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || '초안 생성에 실패했습니다')
      onGenerated(json.draft as OnboardingDraft)
      toast.success('AI 초안을 생성했습니다.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '초안 생성에 실패했습니다')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">AI로 초안을 생성하세요</h2>
        <p className="text-sm text-muted-foreground">
          등록한 자료를 분석해 브랜드 프로필·상품·페르소나 초안을 만듭니다. 최대 2분 정도
          걸릴 수 있습니다.
        </p>
      </div>

      <Card className="bg-gradient-to-br from-fuchsia-50 via-background to-indigo-50 dark:from-fuchsia-950/20 dark:via-background dark:to-indigo-950/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-fuchsia-500" />
            <CardTitle className="text-base">AI 초안 생성</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {extractableCount === 0 ? (
            <p className="text-sm text-muted-foreground">
              추출 완료된 자료가 없습니다. 이전 단계에서 URL이나 문서를 등록하거나, 이 단계를
              건너뛰고 직접 입력할 수 있습니다.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              분석 가능한 자료 {extractableCount}건을 기반으로 초안을 생성합니다.
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="button" disabled={extractableCount === 0 || generating} onClick={generate}>
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> 생성 중… (최대 2분)
                </>
              ) : hasDraft ? (
                <>
                  <RefreshCw className="h-4 w-4" /> 초안 재생성
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> AI로 초안 생성
                </>
              )}
            </Button>
            {hasDraft && !generating && (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="mr-1 h-3 w-3" /> 초안 준비됨
              </Badge>
            )}
          </div>

          {hasDraft && draft && (
            <div className="rounded-md border bg-background/80 p-4 text-sm">
              <p className="font-medium">{draft.brandProfile.companyName || '회사명 미확인'}</p>
              <p className="mt-1 text-muted-foreground">
                상품 {draft.products.length}개 · 페르소나 {draft.personas.length}개 초안 생성됨
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
