'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type OnboardingStepKey = 'resources' | 'generate' | 'brand' | 'catalog' | 'channels'

export const ONBOARDING_STEPS: Array<{ key: OnboardingStepKey; label: string }> = [
  { key: 'resources', label: '자료 등록' },
  { key: 'generate', label: 'AI 초안 생성' },
  { key: 'brand', label: '브랜드 프로필' },
  { key: 'catalog', label: '상품·페르소나' },
  { key: 'channels', label: '배포 채널' },
]

type Props = {
  current: OnboardingStepKey
  onSelect: (key: OnboardingStepKey) => void
}

// 원형 번호 배지 스텝퍼 (5단계). 완료 단계는 체크, 현재 단계는 primary 채움.
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
