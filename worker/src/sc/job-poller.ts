// Sales Content Job Poller — 맥미니 상주 워커가 웹앱의 /api/sc/jobs/worker 를 polling.
// 현재 스켈레톤: claim 된 job 을 각 Publisher/Collector 로 위임하는 라우터만 포함.
// 실제 Publisher/Collector 어댑터는 Unit 10/12 에서 채운다.

// 웹앱 /api/sc/jobs/worker 응답 contract — contracts.ts 에서 단일 진실 관리.
import type { WorkerJobKind, WorkerJobResponse } from './contracts.js'
type ClaimedJob = WorkerJobResponse

const WEB_APP_URL = process.env.WEB_APP_URL ?? 'http://127.0.0.1:3000'
const WORKER_API_KEY = process.env.WORKER_API_KEY
const WORKER_ID = process.env.SC_WORKER_ID ?? `sc-worker-${process.pid}`

// 워커 → 웹앱 모든 fetch 의 기본 타임아웃. 웹앱 응답이 hang 하면 polling 루프 전체가 멈추므로 필수.
// SC_WORKER_FETCH_TIMEOUT_MS 로 override 가능 (default 15s).
const FETCH_TIMEOUT_MS = Number(process.env.SC_WORKER_FETCH_TIMEOUT_MS ?? '15000')

/** AbortController + timeout 으로 감싼 fetch. 타임아웃 시 AbortError throw. */
async function fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function claimJobs(params: {
  kinds?: WorkerJobKind[]
  limit?: number
}): Promise<ClaimedJob[]> {
  if (!WORKER_API_KEY) throw new Error('WORKER_API_KEY 환경변수가 필요합니다')

  const qs = new URLSearchParams()
  qs.set('workerId', WORKER_ID)
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.kinds?.length) qs.set('kinds', params.kinds.join(','))

  const res = await fetchWithTimeout(`${WEB_APP_URL}/api/sc/jobs/worker?${qs.toString()}`, {
    headers: { 'x-worker-api-key': WORKER_API_KEY },
  })
  if (!res.ok) {
    throw new Error(`claim 실패: ${res.status} ${await res.text().catch(() => '')}`)
  }
  const data = (await res.json()) as { jobs: ClaimedJob[] }
  return data.jobs
}

export type WorkerMetricInput = {
  date: string // ISO 또는 YYYY-MM-DD
  source?: 'MANUAL' | 'API' | 'BROWSER' | 'INTERNAL'
  impressions?: number | null
  views?: number | null
  likes?: number | null
  comments?: number | null
  shares?: number | null
  externalClicks?: number | null
}

// 웹앱 /api/sc/metrics/.../worker 의 max(60) 검증과 일치 — 안전 마진을 둬 50건씩 분할.
// 한 chunk 가 실패하면 즉시 중단(부분 진행 카운트만 보고). 다음 sweep 에서 재시도된다.
const METRICS_CHUNK_SIZE = 50

/** Collector 결과를 웹앱 metrics worker 엔드포인트에 upsert. 실패해도 throw 없이 false 반환.
 * 60건 이상의 metrics 는 자동으로 chunk(50) 단위로 분할 POST. */
export async function reportMetrics(
  deploymentId: string,
  metrics: WorkerMetricInput[]
): Promise<{ ok: boolean; count: number; errorMessage?: string }> {
  if (!WORKER_API_KEY) throw new Error('WORKER_API_KEY 환경변수가 필요합니다')
  if (metrics.length === 0) return { ok: true, count: 0 }

  let totalUpserted = 0
  for (let i = 0; i < metrics.length; i += METRICS_CHUNK_SIZE) {
    const chunk = metrics.slice(i, i + METRICS_CHUNK_SIZE)
    try {
      const res = await fetchWithTimeout(`${WEB_APP_URL}/api/sc/metrics/${deploymentId}/worker`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-worker-api-key': WORKER_API_KEY,
        },
        body: JSON.stringify({ metrics: chunk }),
      })
      if (!res.ok) {
        return {
          ok: false,
          count: totalUpserted,
          errorMessage: `metrics upsert 실패 (chunk ${i / METRICS_CHUNK_SIZE + 1}): ${res.status} ${await res.text().catch(() => '')}`,
        }
      }
      const data = (await res.json()) as { upserted: number }
      totalUpserted += data.upserted ?? chunk.length
    } catch (err) {
      return {
        ok: false,
        count: totalUpserted,
        errorMessage: err instanceof Error ? err.message : String(err),
      }
    }
  }
  return { ok: true, count: totalUpserted }
}

/** 웹앱에 job 종료 보고. 실패 시 예외 throw 대신 false 반환 — pollOnce 가 처리하지 않도록.
 * 보고 실패 시 job 은 CLAIMED 상태로 남아 stale-claim reaper 가 회복한다. */
export async function completeJob(
  jobId: string,
  ok: boolean,
  meta?: {
    errorMessage?: string
    errorCode?: string
    platformUrl?: string
  }
): Promise<{ reported: boolean }> {
  if (!WORKER_API_KEY) throw new Error('WORKER_API_KEY 환경변수가 필요합니다')
  try {
    const res = await fetchWithTimeout(`${WEB_APP_URL}/api/sc/jobs/${jobId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-api-key': WORKER_API_KEY,
      },
      body: JSON.stringify({ ok, ...meta }),
    })
    if (!res.ok) {
      console.warn(
        `[sc-poller] completeJob ${jobId} 보고 실패: ${res.status} ${await res.text().catch(() => '')}`
      )
      return { reported: false }
    }
    return { reported: true }
  } catch (err) {
    console.warn(
      `[sc-poller] completeJob ${jobId} 보고 예외: ${err instanceof Error ? err.message : String(err)}`
    )
    return { reported: false }
  }
}

// 1회 polling 사이클 — Unit 10+ 에서 Publisher/Collector factory 주입 예정.
export async function pollOnce(
  handleJob: (c: ClaimedJob) => Promise<{
    ok: boolean
    errorMessage?: string
    errorCode?: string
    platformUrl?: string
  }>
): Promise<{ processed: number; failed: number }> {
  const claimed = await claimJobs({ limit: 5 })
  let processed = 0
  let failed = 0

  for (const c of claimed) {
    try {
      const result = await handleJob(c)
      await completeJob(c.job.id, result.ok, {
        errorMessage: result.errorMessage,
        errorCode: result.errorCode,
        platformUrl: result.platformUrl,
      })
      if (result.ok) processed += 1
      else failed += 1
    } catch (err) {
      // routeJob 자체 예외 — runner 의 분기별 try/catch 를 빠져나간 경우. 일시 오류로 분류해 retry 허용.
      // (영구 오류는 routeJob 내부에서 적절한 errorCode 로 명시 반환됨.)
      // completeJob 은 throw 하지 않음 — 보고 실패는 stale-claim reaper 가 회복.
      await completeJob(c.job.id, false, {
        errorMessage: err instanceof Error ? err.message : String(err),
        errorCode: 'PLATFORM_ERROR',
      })
      failed += 1
    }
  }

  return { processed, failed }
}
