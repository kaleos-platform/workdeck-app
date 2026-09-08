'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type OnboardingStepKey = 'resources' | 'generate' | 'review'

export const ONBOARDING_STEPS: Array<{ key: OnboardingStepKey; label: string }> = [
  { key: 'resources', label: '자료 등록' },
  { key: 'generate', label: '자료 분석' },
  { key: 'review', label: '검토·저장' },
]

type Props = {
  current: OnboardingStepKey
  onSelect: (key: OnboardingStepKey) => void
}

// 현재 단계까지의 진행 위치를 표시한다.
export function WizardStepper({ current, onSelect }: Props) {
  const currentIndex = ONBOARDING_STEPS.findIndex((s) => s.key === current)

  return (
    <nav className="flex flex-wrap items-center justify-center gap-2">
      {ONBOARDING_STEPS.map((s, idx) => {
        const active = idx === currentIndex
        const done = idx < currentIndex
        return (
          <div key={s.key} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSelect(s.key)}
              className="flex items-center gap-2"
            >
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full border text-xs font-medium transition',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : done
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground'
                )}
              >
                {done ? <Check className="size-3.5" /> : idx + 1}
              </span>
              <span
                className={cn(
                  'text-sm font-medium transition',
                  active ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {s.label}
              </span>
            </button>
            {idx < ONBOARDING_STEPS.length - 1 && (
              <span className="mx-1 h-px w-6 bg-border" aria-hidden />
            )}
          </div>
        )
      })}
    </nav>
  )
}
