import * as Sentry from '@sentry/nextjs'

const sentryEnvironment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'
const isProduction = sentryEnvironment === 'production'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: sentryEnvironment,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: isProduction ? 0.2 : 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: !isProduction,
})
