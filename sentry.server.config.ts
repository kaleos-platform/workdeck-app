import * as Sentry from '@sentry/nextjs'
import { IGNORE_ERRORS, scrubBreadcrumb, scrubEvent } from '@/lib/sentry/scrub'

const sentryEnvironment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'
const isProduction = sentryEnvironment === 'production'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: sentryEnvironment,

  tracesSampleRate: isProduction ? 0.05 : 0,
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
