'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SALES_CONTENT_HOME_PATH } from '@/lib/deck-routes'
import { WizardStepper, type OnboardingStepKey } from './wizard-stepper'
import { StepResources } from './step-resources'
import { StepGenerate } from './step-generate'
import { StepReview } from './step-review'
import type { WizardData } from './types'

export function OnboardingWizard(props: WizardData) {
  const [step, setStep] = useState<OnboardingStepKey>(
    props.draftStatus === 'READY' ? 'review' : 'resources'
  )
  const [resources, setResources] = useState(props.resources)
  const [logoUrl, setLogoUrl] = useState(props.logoUrl)
  const [draft, setDraft] = useState(props.draft)
  const [brandProfile, setBrandProfile] = useState(props.brandProfile)
  const [audience, setAudience] = useState(props.draft?.audience ?? '기업 ESG 담당자')
  const [busy, setBusy] = useState(false)
  const [resourcesBusy, setResourcesBusy] = useState(false)
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 pb-28 sm:p-6 sm:pb-28">
      <Link href={SALES_CONTENT_HOME_PATH} className="text-sm text-muted-foreground">
        ← 세일즈 콘텐츠 홈
      </Link>
      <div>
        <h1 className="text-xl font-semibold">회사 자료로 시작하기</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          자료를 등록하면 제품·ESG 근거와 고객 초안을 함께 정리합니다.
        </p>
      </div>
      <WizardStepper
        current={step}
        onSelect={(next) => {
          if (!busy && !resourcesBusy) setStep(next)
        }}
      />
      <div hidden={step !== 'resources'} className="space-y-6">
        <StepResources
          resources={resources}
          onResourcesChange={setResources}
          logoUrl={logoUrl}
          onLogoChange={setLogoUrl}
          onBusyChange={setResourcesBusy}
        />
        <div className="space-y-2">
          <Label htmlFor="onboarding-audience">주요 고객 (선택)</Label>
          <Input
            id="onboarding-audience"
            value={audience}
            maxLength={200}
            onChange={(event) => setAudience(event.target.value)}
          />
        </div>
        <Button onClick={() => setStep('generate')} disabled={!resources.length || resourcesBusy}>
          자료 분석으로
        </Button>
      </div>
      <div hidden={step !== 'generate'} className="space-y-6">
        <StepGenerate
          resources={resources}
          draft={draft}
          draftStatus={props.draftStatus}
          audience={audience}
          onResourcesChange={setResources}
          onBusyChange={setBusy}
          onGenerated={(next) => {
            setDraft(next)
            setStep('review')
          }}
        />
        {draft && (
          <Button variant="outline" disabled={busy} onClick={() => setStep('review')}>
            준비된 초안 검토
          </Button>
        )}
      </div>
      <div hidden={step !== 'review'}>
        <StepReview
          key={JSON.stringify(draft)}
          initial={brandProfile}
          onSaved={setBrandProfile}
          draft={draft}
          active={step === 'review'}
        />
      </div>
    </div>
  )
}
