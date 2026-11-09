import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'
import { sendSystemNotification } from '@/lib/slack/send-notification'
import { evaluateDbHealth, parseMetrics, type MetricValues } from '@/lib/ops/db-health'

export const runtime = 'nodejs'
export const maxDuration = 60

const PATH = '/api/cron/db-health'
const SAMPLE_GAP_MS = 10_000
const STEP_TIMEOUT_MS = 8_000
const RENOTIFY_WINDOW_MS = 60 * 60 * 1000

/** 제한 시간 안에 끝나지 않거나 실패하면 null — DB 가 멈춰도 cron 자체는 끝까지 돈다. */
async function within<T>(work: Promise<T>, ms = STEP_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([work.catch(() => null), timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function sampleMetrics(): Promise<MetricValues | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return null
  const auth = Buffer.from(`service_role:${key}`).toString('base64')
  return within(
    fetch(`${base}/customer/v1/privileged/metrics`, {
      headers: { authorization: `Basic ${auth}` },
      cache: 'no-store',
    }).then(async (res) => (res.ok ? parseMetrics(await res.text()) : null))
  )
}

async function pingDb(): Promise<number | null> {
  const started = Date.now()
  const ok = await within(prisma.$queryRaw`SELECT 1 AS ok`)
  return ok ? Date.now() - started : null
}

/**
 * GET /api/cron/db-health — 10분마다 운영 DB 서버의 swap·응답 지연을 보고 기준을 넘으면 알린다.
 * 시스템 알림은 Slack 채널·토큰을 DB 에서 읽어 DB 장애 때는 못 나간다 → OPS_SLACK_WEBHOOK_URL 로 한 번 더.
 */
export const GET = withCronRun(PATH, async () => {
  const a = await sampleMetrics()
  const aAt = Date.now()
  const pingMs = await pingDb()
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, SAMPLE_GAP_MS - (Date.now() - aAt)))
  )
  const b = await sampleMetrics()
  const health = evaluateDbHealth({ a, b, dtSec: (Date.now() - aAt) / 1000, pingMs })

  if (health.problems.length === 0) return { ...health, notified: false }

  const recent = await within(
    prisma.cronRun.findFirst({
      where: {
        path: PATH,
        startedAt: { gte: new Date(Date.now() - RENOTIFY_WINDOW_MS) },
        detail: { path: ['notified'], equals: true },
      },
      select: { id: true },
    })
  )
  if (recent) return { ...health, notified: false, deduped: true }

  const stats = [
    health.swapInMBs !== undefined && `swap-in ${health.swapInMBs.toFixed(1)}MB/s`,
    health.diskReadMBs !== undefined && `디스크 읽기 ${health.diskReadMBs.toFixed(0)}MB/s`,
    health.swapUsedMB !== undefined && `swap 사용 ${health.swapUsedMB}MB`,
    `DB 응답 ${pingMs === null ? '없음' : `${pingMs}ms`}`,
  ].filter(Boolean)
  const text = `:rotating_light: 운영 DB 서버 이상 — ${health.problems.join(', ')}\n${stats.join(' · ')}`

  let notified = await within(
    sendSystemNotification({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }], text })
  )
  const webhook = process.env.OPS_SLACK_WEBHOOK_URL
  if (!notified && webhook) {
    const res = await within(
      fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
    )
    notified = Boolean(res?.ok)
  }
  return { ...health, notified: Boolean(notified) }
})
