import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/client'
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
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0,
})

// 사용자 식별은 id 만(이메일 금지)
createClient().auth.onAuthStateChange((_e, session) =>
  Sentry.setUser(session?.user ? { id: session.user.id } : null)
)

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
