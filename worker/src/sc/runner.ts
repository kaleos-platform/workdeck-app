// Sales Content 워커 러너 — kind 별 라우팅 + 무한 polling 루프.
// routeJob 은 순수 의존성 주입 함수로 분리되어 있어 테스트에서 mock 주입이 가능하다.

import { pollOnce } from './job-poller.js'
import { getPublisher, type PublishContext } from './publishers/index.js'
import { getCollector, type CollectContext } from './collectors/index.js'
import { handleInsightSweep } from './insight-generator.js'

// job-poller 의 ClaimedJob 은 deployment/credential 을 unknown 으로 유지한다.
// 웹앱 /api/sc/jobs/worker 응답 형식이 아직 강 타입화되지 않았으므로
// 각 브랜치에서 as-cast 로 컨텍스트를 구성한다.
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
}

type RouteResult = {
  ok: boolean
  errorMessage?: string
  platformUrl?: string
}

export type RouteDeps = {
  getPublisher: typeof getPublisher
  getCollector: typeof getCollector
  handleInsightSweep: typeof handleInsightSweep
}

const realDeps: RouteDeps = { getPublisher, getCollector, handleInsightSweep }

/**
 * 단일 job 을 kind 에 따라 적절한 핸들러로 라우팅한다.
 * deps 를 주입받으므로 테스트에서 mock 교체 가능.
 */
export async function routeJob(c: ClaimedJob, deps: RouteDeps = realDeps): Promise<RouteResult> {
  const { kind } = c.job

  switch (kind) {
    case 'PUBLISH': {
      // 웹앱 응답에서 deployment/channel/content/assets/credential/deploymentUrl 이
      // PublishContext 형태로 내려온다고 가정. 강 타입 없으므로 cast.
      const ctx = buildPublishContext(c)
      if (!ctx) {
        return {
          ok: false,
          errorMessage:
            'PUBLISH job payload 에서 PublishContext 를 구성할 수 없음 (deployment/channel 누락)',
        }
      }
      try {
        const publisher = deps.getPublisher(ctx)
        const result = await publisher.publish(ctx)
        // errorCode 는 로컬 로깅 + 재시도 판단용. 웹앱 API 에는 전달하지 않음.
        if (!result.ok && result.errorCode) {
          console.warn(
            `[sc-runner] PUBLISH 실패 [${result.errorCode}] ${publisher.name}: ${result.errorMessage}`
          )
          logRetryHint(result.errorCode)
        }
        return { ok: result.ok, errorMessage: result.errorMessage, platformUrl: result.platformUrl }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[sc-runner] Publisher 미구현 또는 예외: ${msg}`)
        return { ok: false, errorMessage: msg }
      }
    }

    case 'COLLECT_METRIC': {
      const ctx = buildCollectContext(c)
      if (!ctx) {
        return {
          ok: false,
          errorMessage:
            'COLLECT_METRIC job payload 에서 CollectContext 를 구성할 수 없음 (deployment/channel 누락)',
        }
      }
      const collector = deps.getCollector(ctx)
      if (!collector) {
        // collectorMode=NONE/MANUAL — 수집 대상 없음. ok:true 로 완료.
        console.log(`[sc-runner] COLLECT_METRIC: collector 없음 (NONE/MANUAL 모드) — 완료 처리`)
        return { ok: true }
      }
      const result = await collector.collect(ctx)
      if (!result.ok && result.errorCode) {
        console.warn(
          `[sc-runner] COLLECT_METRIC 실패 [${result.errorCode}] ${collector.name}: ${result.errorMessage}`
        )
        logRetryHint(result.errorCode)
      }
      if (result.ok && result.metrics?.length) {
        // TODO(Unit 18+): metrics 를 웹앱 API 로 upsert. 현재는 stdout 로깅.
        console.log(
          `[sc-runner] COLLECT_METRIC metrics (${result.metrics.length}건) — 저장 미구현, 로그만`
        )
      }
      return { ok: result.ok, errorMessage: result.errorMessage }
    }

    case 'INSIGHT_SWEEP': {
      const result = await deps.handleInsightSweep(c as Parameters<typeof handleInsightSweep>[0])
      return { ok: result.ok, errorMessage: result.errorMessage }
    }

    default: {
      const _exhaustive: never = kind
      return { ok: false, errorMessage: `알 수 없는 job kind: ${_exhaustive}` }
    }
  }
}

/** errorCode 기반 재시도 가능 여부 힌트 로깅 */
function logRetryHint(errorCode: string): void {
  const retryable =
    errorCode === 'NETWORK' || errorCode === 'PLATFORM_ERROR' || errorCode === 'RATE_LIMITED'
  if (retryable) {
    console.log(`[sc-runner] errorCode=${errorCode} — 재시도 가능 (네트워크/플랫폼 일시 오류)`)
  } else {
    console.log(
      `[sc-runner] errorCode=${errorCode} — 재시도 불필요 (자격증명·구현 문제, 운영 확인 필요)`
    )
  }
}

/** ClaimedJob → PublishContext 변환. 웹앱 응답 형식 기준 cast. */
function buildPublishContext(c: ClaimedJob): PublishContext | null {
  const d = c.deployment as Record<string, unknown> | undefined
  const payload = c.job.payload as Record<string, unknown> | undefined
  if (!d || !payload) return null

  const channel = payload['channel'] as PublishContext['channel'] | undefined
  const content = payload['content'] as PublishContext['content'] | undefined
  const assets = (payload['assets'] ?? []) as PublishContext['assets']
  const deploymentUrl = (payload['deploymentUrl'] ?? '') as string

  if (!channel || !content) return null

  return {
    deployment: d as unknown as PublishContext['deployment'],
    channel,
    content,
    assets,
    credential: c.credential as PublishContext['credential'],
    deploymentUrl,
  }
}

/** ClaimedJob → CollectContext 변환. 웹앱 응답 형식 기준 cast. */
function buildCollectContext(c: ClaimedJob): CollectContext | null {
  const d = c.deployment as Record<string, unknown> | undefined
  const payload = c.job.payload as Record<string, unknown> | undefined
  if (!d) return null

  const channel = (payload?.['channel'] ?? d['channel']) as CollectContext['channel'] | undefined
  if (!channel) return null

  return {
    deployment: d as unknown as CollectContext['deployment'],
    channel,
    credential: c.credential as CollectContext['credential'],
  }
}

/** sc 워커 무한 polling 루프. SIGTERM/SIGINT 로 graceful shutdown. */
export async function runScLoop(options?: { intervalMs?: number }): Promise<void> {
  const intervalMs = options?.intervalMs ?? 5_000

  let stopped = false
  const shutdown = () => {
    if (!stopped) {
      console.log('[sc-runner] shutdown signal 수신 — 다음 poll 후 종료')
      stopped = true
    }
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  // 부팅 확인 로그 — 첫 poll 이전에 출력하므로 WORKER_API_KEY 오류보다 먼저 표시됨
  console.log('[sc-runner] sc worker started')

  while (!stopped) {
    try {
      const { processed, failed } = await pollOnce((c) => routeJob(c, realDeps))
      if (processed + failed > 0) {
        console.log(`[sc-runner] poll 완료 — processed=${processed}, failed=${failed}`)
      }
    } catch (err) {
      console.error('[sc-runner] poll 오류 (재시도):', err instanceof Error ? err.message : err)
    }

    if (!stopped) {
      await sleep(intervalMs)
    }
  }

  console.log('[sc-runner] sc worker stopped')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
