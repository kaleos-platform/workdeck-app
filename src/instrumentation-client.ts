import * as Sentry from '@sentry/nextjs'

const sentryEnvironment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'
const isProduction = sentryEnvironment === 'production'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: sentryEnvironment,

  tracesSampleRate: isProduction ? 0.2 : 1.0,
  debug: !isProduction,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: isProduction ? 0.1 : 1.0,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
