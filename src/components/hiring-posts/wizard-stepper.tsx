'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type WizardStepKey = 'basic' | 'form' | 'decorate'

export const WIZARD_STEPS: Array<{ key: WizardStepKey; label: string }> = [
  { key: 'basic', label: '공고 기본 정보' },
  { key: 'decorate', label: '공고 꾸미기' },
]

type Props = {
  current: WizardStepKey
  onSelect: (key: WizardStepKey) => void
  disabled?: boolean
}

// 공고 제작은 2단계로 진행하고 지원 접수 설정은 필요할 때 별도로 연다.
export function WizardStepper({ current, onSelect, disabled = false }: Props) {
  return (
    <nav aria-label="공고 편집 단계" className="flex flex-wrap items-center justify-center gap-4">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {WIZARD_STEPS.map((step, index) => (
          <div key={step.key} className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              aria-current={current === step.key ? 'step' : undefined}
              onClick={() => onSelect(step.key)}
              className="flex items-center gap-2 disabled:opacity-50"
            >
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full border text-xs font-medium',
                  current === step.key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground'
                )}
              >
                {index + 1}
              </span>
              <span
                className={cn(
                  'text-sm font-medium',
                  current === step.key ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {step.label}
              </span>
            </button>
            {index < WIZARD_STEPS.length - 1 && (
              <span className="mx-1 h-px w-8 bg-border" aria-hidden />
            )}
          </div>
        ))}
      </div>
      <Button
        type="button"
        size="sm"
        variant={current === 'form' ? 'secondary' : 'ghost'}
        aria-pressed={current === 'form'}
        disabled={disabled}
        onClick={() => onSelect('form')}
      >
        지원서 설정
      </Button>
    </nav>
  )
}
