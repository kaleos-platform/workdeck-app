'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RECRUITING_POSTINGS_PATH } from '@/lib/deck-routes'
import { PostingStatusBadge, type PostingStatus } from './status-badge'
import { WizardStepper, WIZARD_STEPS, type WizardStepKey } from './wizard-stepper'
import { StepBasic } from './step-basic'
import { StepFormSettings } from './step-form-settings'
import { StepPositions } from './step-positions'
import { StepStores } from './step-stores'
import { StepForm } from './step-form'
import { StepPublish } from './step-publish'
import { ApplicationFormPreview } from './application-form-preview'
import { ContentBlockEditor } from './content-block-editor'
import { PostingPreview } from './posting-preview'
import type { FormFieldInput } from '@/lib/validations/hiring-posts'
import type {
  WizardContentData,
  WizardData,
  WizardPositionData,
  WizardState,
  WizardStore,
} from './build-types'

// "YYYY-MM-DDT..." → date input 용 "YYYY-MM-DD"
function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : ''
}

// 좌측 섹션 래퍼 (제목 + 본문)
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

const STEP_ORDER: WizardStepKey[] = WIZARD_STEPS.map((s) => s.key)

export function BuildWizard({ data }: { data: WizardData }) {
  const [step, setStep] = useState<WizardStepKey>('basic')
  const [state, setState] = useState<WizardState>(() => ({
    title: data.posting.title,
    closingDate: toDateInput(data.posting.closingDate),
    notificationEnabled: data.posting.notificationEnabled,
    positions: data.posting.positions,
    stores: data.spaceStores,
    storeIds: data.posting.storeIds,
    noStores: false,
    formFields: data.posting.formFields,
    contents: data.posting.contents,
    status: data.posting.status,
  }))

  function patch(p: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...p }))
  }

  const currentIndex = STEP_ORDER.indexOf(step)
  const isFirst = currentIndex === 0
  const isLast = currentIndex === STEP_ORDER.length - 1

  function goPrev() {
    if (!isFirst) setStep(STEP_ORDER[currentIndex - 1])
  }
  function goNext() {
    if (!isLast) setStep(STEP_ORDER[currentIndex + 1])
  }

  const gridCls = 'grid gap-8 lg:grid-cols-[38fr_62fr] xl:gap-[50px]'

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href={RECRUITING_POSTINGS_PATH}
            className="text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold">{state.title || '제목 없는 공고'}</h1>
            <p className="text-xs text-muted-foreground">공고 빌드 위저드</p>
          </div>
        </div>
        <PostingStatusBadge status={state.status} />
      </div>

      <WizardStepper current={step} onSelect={setStep} />

      {/* STEP 1 — 공고 기본 정보 */}
      {step === 'basic' && (
        <div className="mx-auto w-full max-w-3xl">
          <div className="space-y-8">
            <Section title="기본 정보">
              <StepBasic
                postingId={data.posting.id}
                value={{ title: state.title }}
                onChange={patch}
              />
            </Section>
            <Section title="모집 직무">
              <StepPositions
                postingId={data.posting.id}
                positions={state.positions}
                spacePositions={data.spacePositions}
                onChange={(positions: WizardPositionData[]) => patch({ positions })}
              />
            </Section>
            <Section title="모집 장소">
              <StepStores
                postingId={data.posting.id}
                value={{ stores: state.stores, storeIds: state.storeIds, noStores: state.noStores }}
                onChange={(
                  p: Partial<{ stores: WizardStore[]; storeIds: string[]; noStores: boolean }>
                ) => patch(p)}
              />
            </Section>
          </div>
        </div>
      )}

      {/* STEP 2 — 지원서 폼 제작 */}
      {step === 'form' && (
        <div className={gridCls}>
          <div className="space-y-8">
            <Section title="지원서 마감일">
              <StepFormSettings
                postingId={data.posting.id}
                value={{
                  closingDate: state.closingDate,
                  notificationEnabled: state.notificationEnabled,
                }}
                onChange={patch}
              />
            </Section>
            <Section title="지원서 항목">
              <StepForm
                postingId={data.posting.id}
                initialFields={data.posting.formFields}
                onChange={(formFields: FormFieldInput[]) => patch({ formFields })}
              />
            </Section>
          </div>
          <div className="lg:sticky lg:top-6 lg:self-start">
            <ApplicationFormPreview
              title={state.title}
              closingDate={state.closingDate}
              fields={state.formFields}
            />
          </div>
        </div>
      )}

      {/* STEP 3 — 공고 꾸미기 */}
      {step === 'decorate' && (
        <div className={gridCls}>
          <div>
            <ContentBlockEditor
              postingId={data.posting.id}
              contents={state.contents}
              onChange={(contents: WizardContentData[]) => patch({ contents })}
            />
          </div>
          <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-xl border p-4">
              <StepPublish
                postingId={data.posting.id}
                uuid={data.posting.uuid}
                title={state.title}
                status={state.status}
                positionCount={state.positions.length}
                formFields={state.formFields}
                onStatusChange={(status: PostingStatus) => patch({ status })}
              />
            </div>
            <PostingPreview
              status={state.status}
              title={state.title}
              positions={state.positions}
              stores={state.stores}
              storeIds={state.storeIds}
              noStores={state.noStores}
              contents={state.contents}
            />
          </div>
        </div>
      )}

      {/* 하단 CTA */}
      <div className="flex items-center justify-between border-t pt-6">
        <Button variant="outline" className="min-w-28" disabled={isFirst} onClick={goPrev}>
          <ArrowLeft /> 이전
        </Button>
        <div className="flex items-center gap-3">
          {step === 'form' && (
            <Button variant="ghost" className="min-w-24" onClick={goNext}>
              건너뛰기
            </Button>
          )}
          {!isLast ? (
            <Button className="min-w-28" onClick={goNext}>
              다음 <ArrowRight />
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">우측 발행 카드에서 공고를 발행하세요.</p>
          )}
        </div>
      </div>
    </div>
  )
}
