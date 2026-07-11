'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type WizardStepKey = 'basic' | 'form' | 'decorate'

export const WIZARD_STEPS: Array<{ key: WizardStepKey; label: string }> = [
  { key: 'basic', label: '공고 기본 정보' },
  { key: 'form', label: '지원서 폼 제작' },
  { key: 'decorate', label: '공고 꾸미기' },
]

type Props = {
  current: WizardStepKey
  onSelect: (key: WizardStepKey) => void
}

// 원형 번호 배지 스텝퍼 (3단계). 완료 단계는 체크, 현재 단계는 primary 채움.
export function WizardStepper({ current, onSelect }: Props) {
  const currentIndex = WIZARD_STEPS.findIndex((s) => s.key === current)

  return (
    <nav className="flex items-center justify-center gap-2">
      {WIZARD_STEPS.map((s, idx) => {
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
            {idx < WIZARD_STEPS.length - 1 && (
              <span className="mx-1 h-px w-8 bg-border" aria-hidden />
            )}
          </div>
        )
      })}
    </nav>
  )
}
