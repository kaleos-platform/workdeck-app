import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'
import { sendSystemNotification } from '@/lib/slack/send-notification'
import { evaluateDbHealth, parseMetrics, type MetricValues } from '@/lib/ops/db-health'

export const runtime = 'nodejs'
export const maxDuration = 300

const PATH = '/api/cron/db-health'
// Supabase 지표는 약 60초마다 갱신된다 — 고정 간격 두 샘플은 같은 값이라 속도가 0으로 나온다.
const POLL_MS = 5_000
const CHANGE_WAIT_MS = 90_000
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 지표가 다음으로 갱신될 때까지 기다린다. 제한 시간 안에 안 바뀌면 null(서버 정지 의심). */
async function nextRefresh(prev: MetricValues): Promise<{ v: MetricValues; at: number } | null> {
  const deadline = Date.now() + CHANGE_WAIT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    const v = await sampleMetrics()
    if (v && v.node_cpu_seconds_total !== prev.node_cpu_seconds_total) return { v, at: Date.now() }
  }
  return null
}

async function pingDb(): Promise<number | null> {
  const started = Date.now()
  const ok = await within(prisma.$queryRaw`SELECT 1 AS ok`)
  return ok ? Date.now() - started : null
}

/**
 * GET /api/cron/db-health — 10분마다 운영 DB 서버의 swap·응답 지연을 보고 기준을 넘으면 알린다.
 * 한 번 실행에 지표 갱신 두 번을 기다리므로 1~3분 걸린다.
 * 시스템 알림은 Slack 채널·토큰을 DB 에서 읽어 DB 장애 때는 못 나간다 → OPS_SLACK_WEBHOOK_URL 로 한 번 더.
 */
export const GET = withCronRun(PATH, async () => {
  const [first, pingMs] = await Promise.all([sampleMetrics(), pingDb()])
  // 속도는 연속 두 갱신 사이(약 60초)로 잰다 — 첫 샘플은 갱신 주기 중간일 수 있어 기준점으로 못 쓴다.
  const s1 = first && (await nextRefresh(first))
  const s2 = s1 && (await nextRefresh(s1.v))
  const health = evaluateDbHealth({
    a: s1?.v ?? null,
    b: s2?.v ?? null,
    dtSec: s1 && s2 ? (s2.at - s1.at) / 1000 : 0,
    pingMs,
  })

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
