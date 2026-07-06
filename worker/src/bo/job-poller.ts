// Blog Ops Job Poller — 웹앱 /api/bo/jobs/claim + /api/bo/jobs/[id]/complete polling.
// sc/job-poller.ts 패턴 적용. sc 와 달리 claim 은 POST body 방식(단건).
//
// 환경변수:
//   WORKER_API_KEY         — 웹앱 인증 (sc 와 공유)
//   WEB_APP_URL            — 웹앱 베이스 URL (기본 http://127.0.0.1:3000)
//   BO_WORKER_ID           — 워커 식별자 (기본 bo-worker-{pid})
//   BO_WORKER_FETCH_TIMEOUT_MS — fetch 타임아웃 ms (기본 15000)

import type { BoJobKind, BoJobMeta, BoPublishContext, BoClaimResponse } from './contracts.js'

const WEB_APP_URL = process.env.WEB_APP_URL ?? 'http://127.0.0.1:3000'
const WORKER_API_KEY = process.env.WORKER_API_KEY
const WORKER_ID = process.env.BO_WORKER_ID ?? `bo-worker-${process.pid}`

// 워커 → 웹앱 fetch 기본 타임아웃. 웹앱 응답 hang 시 polling 루프 전체 정지 방지.
const FETCH_TIMEOUT_MS = Number(process.env.BO_WORKER_FETCH_TIMEOUT_MS ?? '15000')

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

export type BoClaimedJob = { job: BoJobMeta; context: BoPublishContext }

/**
 * 웹앱에 job 을 claim 요청한다 (POST).
 * job 이 없으면 null 반환. 오류 시 throw.
 */
export async function claimJob(params: { kinds?: BoJobKind[] } = {}): Promise<BoClaimedJob | null> {
  if (!WORKER_API_KEY) throw new Error('WORKER_API_KEY 환경변수가 필요합니다')

  const body: { claimedBy: string; kinds?: BoJobKind[] } = { claimedBy: WORKER_ID }
  if (params.kinds?.length) body.kinds = params.kinds

  const res = await fetchWithTimeout(`${WEB_APP_URL}/api/bo/jobs/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-api-key': WORKER_API_KEY,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`bo claim 실패: ${res.status} ${await res.text().catch(() => '')}`)
  }
  const data = (await res.json()) as BoClaimResponse
  if (!data.job) return null
  return data as BoClaimedJob
}

/**
 * 웹앱에 job 종료 보고. 실패 시 throw 대신 false 반환.
 * 보고 실패 시 job 은 CLAIMED 상태로 남아 stale-claim reaper 가 회복한다.
 */
export async function completeJob(
  jobId: string,
  ok: boolean,
  meta?: {
    platformUrl?: string
    errorCode?: string
    errorMessage?: string
  }
): Promise<{ reported: boolean }> {
  if (!WORKER_API_KEY) throw new Error('WORKER_API_KEY 환경변수가 필요합니다')
  try {
    const res = await fetchWithTimeout(`${WEB_APP_URL}/api/bo/jobs/${jobId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-api-key': WORKER_API_KEY,
      },
      body: JSON.stringify({ ok, ...meta }),
    })
    if (!res.ok) {
      console.warn(
        `[bo-poller] completeJob ${jobId} 보고 실패: ${res.status} ${await res.text().catch(() => '')}`
      )
      return { reported: false }
    }
    return { reported: true }
  } catch (err) {
    console.warn(
      `[bo-poller] completeJob ${jobId} 보고 예외: ${err instanceof Error ? err.message : String(err)}`
    )
    return { reported: false }
  }
}

export type PollResult = {
  ok: boolean
  errorMessage?: string
  errorCode?: string
  platformUrl?: string
}

/**
 * 1회 polling 사이클.
 * claim → handleJob → completeJob. job 없으면 즉시 반환.
 */
export async function pollOnce(
  handleJob: (c: BoClaimedJob) => Promise<PollResult>
): Promise<{ processed: number; failed: number }> {
  const claimed = await claimJob({ kinds: ['PUBLISH'] })
  if (!claimed) return { processed: 0, failed: 0 }

  try {
    const result = await handleJob(claimed)
    await completeJob(claimed.job.id, result.ok, {
      errorMessage: result.errorMessage,
      errorCode: result.errorCode,
      platformUrl: result.platformUrl,
    })
    return result.ok ? { processed: 1, failed: 0 } : { processed: 0, failed: 1 }
  } catch (err) {
    // handleJob 자체 예외 — 일시 오류로 간주해 PLATFORM_ERROR 로 보고.
    await completeJob(claimed.job.id, false, {
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: 'PLATFORM_ERROR',
    })
    return { processed: 0, failed: 1 }
  }
}
