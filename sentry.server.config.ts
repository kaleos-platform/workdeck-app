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
