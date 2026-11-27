'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import './globals.css'

// 루트 레이아웃까지 깨졌을 때 — 자체 문서를 그리므로 전역 CSS를 직접 불러오고, 라우터 대신 일반 링크를 쓴다.
export default function GlobalError({
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
    <html lang="ko">
      <body className="antialiased">
        <title>오류가 발생했습니다 | Workdeck</title>
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
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 루트가 깨진 상태라 전체 새로 불러오기로 이동 */}
              <a href="/">홈으로</a>
            </Button>
          </div>
          {error.digest && (
            <p className="text-xs text-muted-foreground">오류 번호: {error.digest}</p>
          )}
        </main>
      </body>
    </html>
  )
}
