import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'
import { sendSystemNotification } from '@/lib/slack/send-notification'
import { evaluateDbHealth, parseMetrics, type MetricValues } from '@/lib/ops/db-health'

export const runtime = 'nodejs'
export const maxDuration = 120

const PATH = '/api/cron/db-health'
// Supabase 지표는 약 60초마다 갱신된다 — 고정 간격 두 샘플은 같은 값이라 속도가 0으로 나온다.
// 연속한 두 값은 정확히 한 수집 주기 차이라, 갱신 한 번만 기다리고 주기(60초)로 나눈다.
const SCRAPE_INTERVAL_SEC = 60
const POLL_MS = 5_000
const CHANGE_WAIT_MS = 90_000
const STEP_TIMEOUT_MS = 8_000
const RENOTIFY_WINDOW_MS = 60 * 60 * 1000

// 중복 억제 1차 저장소 — DB 장애 땐 CronRun 이력을 못 읽어 10분마다 재알림하게 된다.
// ponytail: 인스턴스 메모리라 콜드 스타트마다 비지만, 장애 중 재알림이 몇 번 늘 뿐이다.
let lastNotifiedAt = 0

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

/** 첫 조회 실패는 한 번 다시 — 일시 오류로 「지표 못 읽음」 오탐을 내지 않는다. */
async function firstSample(): Promise<MetricValues | null> {
  const v = await sampleMetrics()
  if (v) return v
  await sleep(POLL_MS)
  return sampleMetrics()
}

async function pingDb(): Promise<number | null> {
  const started = Date.now()
  const ok = await within(prisma.$queryRaw`SELECT 1 AS ok`)
  return ok ? Date.now() - started : null
}

/**
 * GET /api/cron/db-health — 10분마다 운영 DB 서버의 swap·응답 지연을 보고 기준을 넘으면 알린다.
 * 지표 갱신을 한 번 기다리므로 실행에 최대 약 1분 걸린다.
 * 시스템 알림은 Slack 채널·토큰을 DB 에서 읽어 DB 장애 때는 못 나간다 → 웹훅으로 한 번 더.
 */
export const GET = withCronRun(PATH, async () => {
  const [first, pingMs] = await Promise.all([firstSample(), pingDb()])
  const next = first && (await nextRefresh(first))
  const health = evaluateDbHealth({
    a: first,
    b: next?.v ?? null,
    dtSec: SCRAPE_INTERVAL_SEC,
    pingMs,
  })

  if (health.problems.length === 0) return { ...health, notified: false }

  if (Date.now() - lastNotifiedAt < RENOTIFY_WINDOW_MS) {
    return { ...health, notified: false, deduped: true }
  }
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
  // 운영 전용 웹훅이 없으면 도입 신청 알림 웹훅(운영자 채널, DB 비의존)으로 보낸다.
  const webhook = process.env.OPS_SLACK_WEBHOOK_URL ?? process.env.LEAD_SLACK_WEBHOOK_URL
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
  if (notified) lastNotifiedAt = Date.now()
  return { ...health, notified: Boolean(notified) }
})
