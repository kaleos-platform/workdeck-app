'use client'

import * as Sentry from '@sentry/nextjs'
import Link from 'next/link'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <main
      role="alert"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-16 text-center"
    >
      <span className="text-lg font-bold">Workdeck</span>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">문제가 생겨 화면을 보여드리지 못했어요</h1>
        <p className="text-sm text-muted-foreground">잠시 후 다시 시도해 주세요.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()}>다시 시도</Button>
        <Button variant="outline" asChild>
          <Link href="/">홈으로</Link>
        </Button>
      </div>
      {error.digest && <p className="text-xs text-muted-foreground">오류 번호: {error.digest}</p>}
    </main>
  )
}
