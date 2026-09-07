'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SALES_CONTENT_HOME_PATH } from '@/lib/deck-routes'
import { WizardStepper, ONBOARDING_STEPS, type OnboardingStepKey } from './wizard-stepper'
import { StepResources } from './step-resources'
import { StepGenerate } from './step-generate'
import { StepBrand } from './step-brand'
import { StepCatalog } from './step-catalog'
import { StepChannels } from './step-channels'
import type { BrandProfileData, OnboardingDraft, OnboardingResourceData } from './types'

const STEP_ORDER: OnboardingStepKey[] = ONBOARDING_STEPS.map((s) => s.key)

type Props = {
  brandProfile: BrandProfileData | null
  logoUrl: string | null
  productCount: number
  personaCount: number
  channelCount: number
  resources: OnboardingResourceData[]
  draft: OnboardingDraft | null
  draftStatus: string | null
}

export function OnboardingWizard(props: Props) {
  const router = useRouter()
  const [step, setStep] = useState<OnboardingStepKey>('resources')
  const [resources, setResources] = useState(props.resources)
  const [logoUrl, setLogoUrl] = useState(props.logoUrl)
  const [draft, setDraft] = useState(props.draft)
  const [draftStatus, setDraftStatus] = useState(props.draftStatus)
  const [brandProfile, setBrandProfile] = useState(props.brandProfile)
  const [productCount, setProductCount] = useState(props.productCount)
  const [personaCount, setPersonaCount] = useState(props.personaCount)
  const [completing, setCompleting] = useState(false)

  const currentIndex = STEP_ORDER.indexOf(step)
  const isFirst = currentIndex === 0
  const isLast = currentIndex === STEP_ORDER.length - 1

  function goPrev() {
    if (!isFirst) setStep(STEP_ORDER[currentIndex - 1])
  }
  function goNext() {
    if (!isLast) setStep(STEP_ORDER[currentIndex + 1])
  }

  async function handleSkip() {
    if (isLast) {
      setCompleting(true)
      try {
        const res = await fetch('/api/sc/onboarding/status', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ completed: true }),
        })
        if (!res.ok) throw new Error('완료 처리 실패')
        router.push(SALES_CONTENT_HOME_PATH)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '완료 처리 실패')
      } finally {
        setCompleting(false)
      }
      return
    }
    goNext()
  }

  return (
    <div className="flex flex-col p-6">
      {/* 고정 상단: 헤더 + 스테퍼 */}
      <div className="sticky top-0 z-20 -mx-6 space-y-4 border-b bg-background/95 px-6 pb-4 backdrop-blur">
        <div className="flex items-center justify-between gap-4 pt-6">
          <div className="flex items-center gap-3">
            <Link
              href={SALES_CONTENT_HOME_PATH}
              className="text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold">세일즈 콘텐츠 시작하기</h1>
              <p className="text-xs text-muted-foreground">온보딩 위저드</p>
            </div>
          </div>
        </div>

        <WizardStepper current={step} onSelect={setStep} />
      </div>

      <div className="mx-auto w-full max-w-3xl py-8">
        {step === 'resources' && (
          <StepResources
            resources={resources}
            onResourcesChange={setResources}
            logoUrl={logoUrl}
            onLogoChange={setLogoUrl}
          />
        )}
        {step === 'generate' && (
          <StepGenerate
            resources={resources}
            draft={draft}
            draftStatus={draftStatus}
            onGenerated={(d) => {
              setDraft(d)
              setDraftStatus('READY')
            }}
          />
        )}
        {step === 'brand' && (
          <StepBrand
            initial={brandProfile}
            draft={draft}
            onSaved={(data) => {
              setBrandProfile(data)
              goNext()
            }}
          />
        )}
        {step === 'catalog' && (
          <StepCatalog
            draft={draft}
            productCount={productCount}
            personaCount={personaCount}
            onSaved={(savedProducts, savedPersonas) => {
              setProductCount((c) => c + savedProducts)
              setPersonaCount((c) => c + savedPersonas)
              goNext()
            }}
          />
        )}
        {step === 'channels' && <StepChannels channelCount={props.channelCount} />}
      </div>

      {/* 고정 하단 CTA */}
      <div className="sticky bottom-0 z-20 -mx-6 flex items-center justify-between border-t bg-background/95 px-6 py-4 backdrop-blur">
        <Button variant="outline" className="min-w-28" disabled={isFirst} onClick={goPrev}>
          <ArrowLeft /> 이전
        </Button>
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="min-w-24" onClick={handleSkip} disabled={completing}>
            {isLast ? '건너뛰고 완료' : '건너뛰기'}
          </Button>
          {!isLast && (
            <Button className="min-w-28" onClick={goNext}>
              다음 <ArrowRight />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
