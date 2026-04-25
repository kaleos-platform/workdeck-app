// Sales Content Job Poller — 맥미니 상주 워커가 웹앱의 /api/sc/jobs/worker 를 polling.
// 현재 스켈레톤: claim 된 job 을 각 Publisher/Collector 로 위임하는 라우터만 포함.
// 실제 Publisher/Collector 어댑터는 Unit 10/12 에서 채운다.

const WEB_APP_URL = process.env.WEB_APP_URL ?? 'http://127.0.0.1:3000'
const WORKER_API_KEY = process.env.WORKER_API_KEY
const WORKER_ID = process.env.SC_WORKER_ID ?? `sc-worker-${process.pid}`

type ClaimedJob = {
  job: {
    id: string
    kind: 'PUBLISH' | 'COLLECT_METRIC' | 'INSIGHT_SWEEP'
    targetId: string | null
    payload: unknown
    attempts: number
  }
  deployment?: unknown
  credential?: unknown
  // 웹앱 /api/sc/jobs/worker 응답에 PublishContext 평탄화 필드를 함께 내려준다.
  assets?: unknown
  deploymentUrl?: unknown
}

export async function claimJobs(params: {
  kinds?: ('PUBLISH' | 'COLLECT_METRIC' | 'INSIGHT_SWEEP')[]
  limit?: number
}): Promise<ClaimedJob[]> {
  if (!WORKER_API_KEY) throw new Error('WORKER_API_KEY 환경변수가 필요합니다')

  const qs = new URLSearchParams()
  qs.set('workerId', WORKER_ID)
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.kinds?.length) qs.set('kinds', params.kinds.join(','))

  const res = await fetch(`${WEB_APP_URL}/api/sc/jobs/worker?${qs.toString()}`, {
    headers: { 'x-worker-api-key': WORKER_API_KEY },
  })
  if (!res.ok) {
    throw new Error(`claim 실패: ${res.status} ${await res.text().catch(() => '')}`)
  }
  const data = (await res.json()) as { jobs: ClaimedJob[] }
  return data.jobs
}

export async function completeJob(
  jobId: string,
  ok: boolean,
  meta?: {
    errorMessage?: string
    errorCode?: string
    platformUrl?: string
  }
): Promise<void> {
  if (!WORKER_API_KEY) throw new Error('WORKER_API_KEY 환경변수가 필요합니다')
  await fetch(`${WEB_APP_URL}/api/sc/jobs/${jobId}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-api-key': WORKER_API_KEY,
    },
    body: JSON.stringify({ ok, ...meta }),
  })
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
      await completeJob(c.job.id, false, {
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {
        // 리포트 실패는 무시 — 다음 polling 에서 stale claim 이 다시 PENDING 으로 회복되지 않으므로
        // 이 경우 운영이 관찰해 수동 복구해야 한다.
      })
      failed += 1
    }
  }

  return { processed, failed }
}
