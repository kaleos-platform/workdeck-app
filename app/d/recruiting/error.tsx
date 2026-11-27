'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default function RecruitingError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <div
      role="alert"
      className="flex min-h-60 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <h2 className="font-semibold">화면을 불러오지 못했습니다</h2>
      <p className="text-sm text-muted-foreground">잠시 후 다시 시도해 주세요.</p>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(() => {
            router.refresh()
            reset()
          })
        }
      >
        {pending ? '다시 불러오는 중…' : '다시 시도'}
      </Button>
    </div>
  )
}
