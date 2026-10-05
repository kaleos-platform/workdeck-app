'use client'

import {
  isPostingRecruitmentLocked,
  PUBLISHED_POSTING_LOCK_MESSAGE,
} from '@/lib/hiring/publication-policy'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  RECRUITING_POSTINGS_PATH,
  getHiringPublicApplyPath,
  getHiringPublicPostingPath,
  getRecruitingPostingDetailPath,
} from '@/lib/deck-routes'
import { PostingStatusBadge } from './status-badge'
import { WizardStepper, WIZARD_STEPS, type WizardStepKey } from './wizard-stepper'
import { StepBasic, type StepBasicHandle } from './step-basic'
import { StepFormSettings } from './step-form-settings'
import { StepPositions } from './step-positions'
import { StepStores } from './step-stores'
import { useWizardNavigation } from './use-wizard-navigation'
import type { SaveHandle } from './use-queued-save'
import { StepForm, type StepFormHandle } from './step-form'
import { ApplicationFormPreview } from './application-form-preview'
import { ContentBlockEditor, type ContentBlockEditorHandle } from './content-block-editor'
import { PostingPreview } from './posting-preview'
import { PreviewFrame } from './preview-frame'
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
  const router = useRouter()
  const recruitmentLocked = isPostingRecruitmentLocked(data.posting)
  const positionsRef = useRef<SaveHandle>(null)
  const settingsRef = useRef<SaveHandle>(null)
  const storesRef = useRef<SaveHandle>(null)
  const basicRef = useRef<StepBasicHandle>(null)
  const formRef = useRef<StepFormHandle>(null)
  const contentEditorRef = useRef<ContentBlockEditorHandle>(null)
  const leavingRef = useRef(false)
  const [leaving, setLeaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
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

  async function afterSaving(action: () => void | Promise<void>) {
    if (leavingRef.current) return
    leavingRef.current = true
    setLeaving(true)
    setActionError(null)
    try {
      const results = await Promise.allSettled([
        basicRef.current?.flush(),
        settingsRef.current?.flush(),
        storesRef.current?.flush(),
        positionsRef.current?.flush(),
        formRef.current?.flush(),
        contentEditorRef.current?.flush(),
      ])
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
      await action()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '공고 내용을 저장하지 못했습니다. 편집 내용은 유지됩니다. 다시 시도하세요.'
      setActionError(message)
      toast.error(message)
    } finally {
      leavingRef.current = false
      setLeaving(false)
    }
  }

  useWizardNavigation(afterSaving, (url) => router.push(url))

  function selectStep(next: WizardStepKey) {
    void afterSaving(() => setStep(next))
  }
  function goPrev() {
    if (currentIndex > 0) selectStep(STEP_ORDER[currentIndex - 1])
  }
  function goNext() {
    if (currentIndex >= 0 && !isLast) selectStep(STEP_ORDER[currentIndex + 1])
  }

  const gridCls = 'grid gap-8 lg:grid-cols-[38fr_62fr] xl:gap-[50px]'
  // 상단/하단 고정 바 실측 높이 반영 — 우측 sticky 컬럼 top/max-h 계산에 사용
  const TOP_BAR_OFFSET = 'lg:top-[6.5rem]'
  const RIGHT_COL_MAX_H = 'lg:max-h-[calc(100vh-6.5rem-5rem-2rem)]'

  return (
    <div className="flex flex-col p-6">
      {/* 고정 상단: 헤더 + 스테퍼 */}
      <div className="sticky top-0 z-20 -mx-6 space-y-4 border-b bg-background/95 px-6 pb-4 backdrop-blur">
        <div className="flex items-center justify-between gap-4 pt-6">
          <div className="flex items-center gap-3">
            <Link
              href={RECRUITING_POSTINGS_PATH}
              aria-label="공고 목록으로 이동"
              onClick={(event) => {
                event.preventDefault()
                void afterSaving(() => router.push(RECRUITING_POSTINGS_PATH))
              }}
              className="text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold">{state.title || '제목 없는 공고'}</h1>
              <p
                role={leaving ? 'status' : undefined}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                {leaving && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
                {leaving ? '변경사항을 저장하고 있습니다' : '공고 편집'}
              </p>
            </div>
          </div>
          <PostingStatusBadge status={state.status} />
        </div>

        <WizardStepper
          recruitmentLocked={recruitmentLocked}
          current={step}
          onSelect={selectStep}
          disabled={leaving}
        />
        {recruitmentLocked && (
          <p role="note" className="rounded-lg border bg-muted/40 p-3 text-sm">
            {PUBLISHED_POSTING_LOCK_MESSAGE}
          </p>
        )}
        {actionError && (
          <Alert variant="destructive">
            <AlertTitle>요청을 완료하지 못했습니다</AlertTitle>
            <AlertDescription>
              <p>{actionError}</p>
              <p>입력 내용을 확인한 후 원하던 작업을 다시 시도해 주세요.</p>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div inert={leaving} aria-busy={leaving} className="flex flex-col gap-6 py-6">
        {/* STEP 1 — 공고 기본 정보 */}
        {step === 'basic' && (
          <div className="mx-auto w-full max-w-3xl">
            {recruitmentLocked ? (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">공고 제목</dt>
                  <dd>{state.title}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">모집 직무</dt>
                  <dd>{state.positions.map((p) => p.name).join(', ') || '없음'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">모집 장소</dt>
                  <dd>
                    {state.stores
                      .filter((s) => state.storeIds.includes(s.id))
                      .map((s) => s.name)
                      .join(', ') || '없음'}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="space-y-8">
                <Section title="기본 정보">
                  <StepBasic
                    ref={basicRef}
                    postingId={data.posting.id}
                    value={{ title: state.title }}
                    onChange={patch}
                  />
                </Section>
                <Section title="모집 직무">
                  <StepPositions
                    ref={positionsRef}
                    postingId={data.posting.id}
                    positions={state.positions}
                    spacePositions={data.spacePositions}
                    onChange={(positions: WizardPositionData[]) => patch({ positions })}
                  />
                </Section>
                <Section title="모집 장소">
                  <StepStores
                    ref={storesRef}
                    postingId={data.posting.id}
                    value={{
                      stores: state.stores,
                      storeIds: state.storeIds,
                      noStores: state.noStores,
                    }}
                    onChange={(
                      p: Partial<{ stores: WizardStore[]; storeIds: string[]; noStores: boolean }>
                    ) => patch(p)}
                  />
                </Section>
              </div>
            )}
          </div>
        )}

        {/* 선택 설정 — Workdeck 지원 접수 */}
        {step === 'form' && (
          <div className={gridCls}>
            <div className="space-y-8">
              <p className="text-sm text-muted-foreground">
                Workdeck에서 지원자를 접수할 때 사용하는 설정입니다. 외부 채용사이트용 HTML만 만들
                때는 기본 설정을 그대로 둘 수 있습니다.
              </p>
              {!recruitmentLocked && (
                <>
                  <Section title="지원서 마감일">
                    <StepFormSettings
                      ref={settingsRef}
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
                      ref={formRef}
                      postingId={data.posting.id}
                      initialFields={state.formFields}
                      onChange={(formFields: FormFieldInput[]) => patch({ formFields })}
                    />
                  </Section>
                </>
              )}
              {recruitmentLocked && (
                <p className="text-sm font-medium">
                  지원서 설정은 읽기 전용입니다. 기존 항목은 미리보기에서 확인할 수 있습니다.
                </p>
              )}
            </div>
            <div
              className={`space-y-3 lg:sticky ${TOP_BAR_OFFSET} ${RIGHT_COL_MAX_H} lg:self-start lg:overflow-y-auto`}
            >
              <div className="mx-auto flex w-full max-w-sm justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    window.open(
                      `${getHiringPublicApplyPath(data.posting.uuid)}?preview=1`,
                      '_blank'
                    )
                  }
                >
                  <ExternalLink /> 새 탭 미리보기
                </Button>
              </div>
              <div className="mx-auto w-full max-w-sm">
                <ApplicationFormPreview
                  title={state.title}
                  closingDate={state.closingDate}
                  fields={state.formFields}
                />
              </div>
            </div>
          </div>
        )}

        {/* STEP 2 — 공고 꾸미기 */}
        {step === 'decorate' && (
          <div className={gridCls}>
            <div>
              <ContentBlockEditor
                recruitmentLocked={recruitmentLocked}
                ref={contentEditorRef}
                postingId={data.posting.id}
                contents={state.contents}
                positions={state.positions}
                spacePositions={data.spacePositions}
                onPositionsChange={(positions: WizardPositionData[]) => patch({ positions })}
                appliedTemplate={
                  data.posting.appliedTemplateName
                    ? {
                        id: data.posting.appliedTemplateId,
                        name: data.posting.appliedTemplateName,
                        at: data.posting.appliedTemplateAt,
                      }
                    : null
                }
                onChange={(contents: WizardContentData[]) => patch({ contents })}
              />
            </div>
            <div
              className={`space-y-3 lg:sticky ${TOP_BAR_OFFSET} ${RIGHT_COL_MAX_H} lg:self-start lg:overflow-y-auto`}
            >
              <PreviewFrame
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      window.open(
                        `${getHiringPublicPostingPath(data.posting.uuid)}?preview=1`,
                        '_blank'
                      )
                    }
                  >
                    <ExternalLink /> 새 탭 미리보기
                  </Button>
                }
              >
                <PostingPreview
                  status={state.status}
                  title={state.title}
                  positions={state.positions}
                  stores={state.stores}
                  storeIds={state.storeIds}
                  noStores={state.noStores}
                  contents={state.contents}
                />
              </PreviewFrame>
            </div>
          </div>
        )}
      </div>

      {/* 고정 하단 CTA */}
      <div className="sticky bottom-0 z-20 -mx-6 flex items-center justify-between border-t bg-background/95 px-6 py-4 backdrop-blur">
        {step !== 'form' && (
          <Button
            variant="outline"
            className="min-w-28"
            disabled={isFirst || leaving}
            onClick={goPrev}
          >
            <ArrowLeft /> 이전
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
          {step === 'form' ? (
            <Button disabled={leaving} onClick={() => selectStep('decorate')}>
              설정 저장하고 돌아가기
            </Button>
          ) : step === 'decorate' ? (
            <>
              <Button
                className="min-w-28"
                disabled={leaving}
                onClick={() =>
                  void afterSaving(() => {
                    router.push(getRecruitingPostingDetailPath(data.posting.id))
                    router.refresh()
                  })
                }
              >
                {leaving ? '저장 중…' : '저장'}
              </Button>
            </>
          ) : (
            <Button className="min-w-28" disabled={leaving} onClick={goNext}>
              다음 <ArrowRight />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
