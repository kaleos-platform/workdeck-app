import * as Sentry from '@sentry/nextjs'
import { IGNORE_ERRORS, scrubBreadcrumb, scrubEvent } from '@/lib/sentry/scrub'

const sentryEnvironment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: sentryEnvironment,

  // 서버 tracing 끔(옵션 자체를 뺌 — 0 이어도 tracing 초기화는 된다). 켰을 때 스팬 내보내기 재귀가
  // 'RangeError: Maximum call stack size exceeded'(Sentry WORKDECK-APP-1C)로 proxy 프로세스를 죽여
  // 전 경로 간헐 500 을 냈다(2026-11-24 Vercel 로그·Sentry 대조). 다시 켜려면 원인 확인이 먼저.
  debug: false,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
  ignoreErrors: IGNORE_ERRORS,
  // 삼킨 에러 수집(console.error) — 첫 인자만 남도록 scrubEvent 가 정리
  integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
})

// Vercel Node 함수는 응답 직후 멈춰 전송 대기 중인 이벤트가 사라진다(SDK 의 waitUntil 은 edge 전용).
// 이벤트가 생길 때마다 요청 컨텍스트의 waitUntil 로 flush 를 붙잡아 둔다.
Sentry.getClient()?.on('preprocessEvent', () => {
  const ctx = (
    globalThis as { [k: symbol]: { get?: () => { waitUntil?: (p: Promise<unknown>) => void } } }
  )[Symbol.for('@vercel/request-context')]?.get?.()
  ctx?.waitUntil?.(Sentry.flush(2000))
})
