'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, FileText, Briefcase, Store, Image, ListChecks, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PostingStatusBadge, type PostingStatus } from './status-badge'
import { HIRING_POSTS_POSTINGS_PATH } from '@/lib/deck-routes'
import type { WizardData } from './build-types'
import { StepBasic } from './step-basic'
import { StepPositions } from './step-positions'
import { StepStores } from './step-stores'
import { StepDetail } from './step-detail'
import { StepForm } from './step-form'
import { StepPublish } from './step-publish'

type StepKey = 'basic' | 'positions' | 'stores' | 'detail' | 'form' | 'publish'

const STEPS: Array<{ key: StepKey; label: string; icon: typeof FileText }> = [
  { key: 'basic', label: '기본 정보', icon: FileText },
  { key: 'positions', label: '직무', icon: Briefcase },
  { key: 'stores', label: '매장', icon: Store },
  { key: 'detail', label: '상세', icon: Image },
  { key: 'form', label: '지원서 폼', icon: ListChecks },
  { key: 'publish', label: '발행', icon: Send },
]

export function BuildWizard({ data }: { data: WizardData }) {
  const [step, setStep] = useState<StepKey>('basic')
  // 헤더/발행 게이팅에 필요한 최소 상태만 위저드에서 관리
  const [title, setTitle] = useState(data.posting.title)
  const [status, setStatus] = useState<PostingStatus>(data.posting.status)
  const [positionCount, setPositionCount] = useState(data.posting.positions.length)
  const [formFields, setFormFields] = useState(data.posting.formFields)

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href={HIRING_POSTS_POSTINGS_PATH}
            className="text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold">{title || '제목 없는 공고'}</h1>
            <p className="text-xs text-muted-foreground">공고 빌드 위저드</p>
          </div>
        </div>
        <PostingStatusBadge status={status} />
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* 좌측 스텝 네비 */}
        <nav className="flex shrink-0 gap-1 overflow-x-auto lg:w-48 lg:flex-col">
          {STEPS.map((s) => {
            const Icon = s.icon
            const active = step === s.key
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setStep(s.key)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <Icon className="size-4" />
                {s.label}
              </button>
            )
          })}
        </nav>

        {/* 스텝 콘텐츠 */}
        <div className="min-w-0 flex-1">
          {step === 'basic' && (
            <StepBasic
              postingId={data.posting.id}
              initialTitle={data.posting.title}
              initialClosingDate={data.posting.closingDate}
              initialNotificationEnabled={data.posting.notificationEnabled}
              status={status}
              onTitleChange={setTitle}
            />
          )}
          {step === 'positions' && (
            <StepPositions
              postingId={data.posting.id}
              initialPositions={data.posting.positions}
              spacePositions={data.spacePositions}
              onCountChange={setPositionCount}
            />
          )}
          {step === 'stores' && (
            <StepStores
              postingId={data.posting.id}
              initialStoreIds={data.posting.storeIds}
              initialStores={data.spaceStores}
            />
          )}
          {step === 'detail' && (
            <StepDetail postingId={data.posting.id} initialContents={data.posting.contents} />
          )}
          {step === 'form' && (
            <StepForm
              postingId={data.posting.id}
              initialFields={formFields}
              onFieldsChange={setFormFields}
            />
          )}
          {step === 'publish' && (
            <StepPublish
              postingId={data.posting.id}
              uuid={data.posting.uuid}
              title={title}
              status={status}
              positionCount={positionCount}
              formFields={formFields}
              onStatusChange={setStatus}
            />
          )}
        </div>
      </div>
    </div>
  )
}
