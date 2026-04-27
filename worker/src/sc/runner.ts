// Sales Content 워커 러너 — kind 별 라우팅 + 무한 polling 루프.
// routeJob 은 순수 의존성 주입 함수로 분리되어 있어 테스트에서 mock 주입이 가능하다.

import { pollOnce, reportMetrics } from './job-poller.js'
import { getPublisher, type PublishContext } from './publishers/index.js'
import { getCollector, type CollectContext } from './collectors/index.js'
import { handleInsightSweep } from './insight-generator.js'
import type { WorkerJobResponse } from './contracts.js'

// 웹앱 /api/sc/jobs/worker 응답 contract — contracts.ts 에서 단일 진실 관리.
// deployment 는 ContentDeployment + content(+assets) + channel (Prisma include 결과),
// credential 은 readChannelCredential 의 복호화 결과 (또는 null),
// deploymentUrl 은 `${getAppOrigin()}/c/${shortSlug}` 형태의 CTA 링크.
type ClaimedJob = WorkerJobResponse

type RouteResult = {
  ok: boolean
  errorMessage?: string
  errorCode?: string
  platformUrl?: string
}

export type RouteDeps = {
  getPublisher: typeof getPublisher
  getCollector: typeof getCollector
  handleInsightSweep: typeof handleInsightSweep
  reportMetrics: typeof reportMetrics
}

const realDeps: RouteDeps = { getPublisher, getCollector, handleInsightSweep, reportMetrics }

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
          errorCode: 'VALIDATION',
          errorMessage:
            'PUBLISH job payload 에서 PublishContext 를 구성할 수 없음 (deployment/channel 누락)',
        }
      }
      let publisher
      try {
        publisher = deps.getPublisher(ctx)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[sc-runner] Publisher factory 예외: ${msg}`)
        // factory 단계 실패는 (platform, mode) 매칭 불가 등 — 영구 오류.
        return { ok: false, errorCode: 'NOT_IMPLEMENTED', errorMessage: msg }
      }
      try {
        const result = await publisher.publish(ctx)
        if (!result.ok && result.errorCode) {
          console.warn(
            `[sc-runner] PUBLISH 실패 [${result.errorCode}] ${publisher.name}: ${result.errorMessage}`
          )
          logRetryHint(result.errorCode)
        }
        return {
          ok: result.ok,
          errorMessage: result.errorMessage,
          errorCode: result.errorCode,
          platformUrl: result.platformUrl,
        }
      } catch (err) {
        // publisher.publish() 자체에서 throw — 일시적 오류로 간주, retry 허용.
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[sc-runner] Publisher.publish 예외: ${msg}`)
        return { ok: false, errorCode: 'PLATFORM_ERROR', errorMessage: msg }
      }
    }

    case 'COLLECT_METRIC': {
      const ctx = buildCollectContext(c)
      if (!ctx) {
        return {
          ok: false,
          errorCode: 'VALIDATION',
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
      let result
      try {
        result = await collector.collect(ctx)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[sc-runner] Collector.collect 예외: ${msg}`)
        return { ok: false, errorCode: 'PLATFORM_ERROR', errorMessage: msg }
      }
      if (!result.ok && result.errorCode) {
        console.warn(
          `[sc-runner] COLLECT_METRIC 실패 [${result.errorCode}] ${collector.name}: ${result.errorMessage}`
        )
        logRetryHint(result.errorCode)
      }
      if (result.ok && result.metrics?.length) {
        const deploymentId = (c.deployment as { id?: string } | undefined)?.id
        if (!deploymentId) {
          console.warn('[sc-runner] COLLECT_METRIC: deployment.id 없음 — metrics upsert 스킵')
        } else {
          const upsert = await deps.reportMetrics(
            deploymentId,
            result.metrics.map((m) => ({
              date: m.date.toISOString(),
              source: 'BROWSER',
              impressions: m.impressions ?? null,
              views: m.views ?? null,
              likes: m.likes ?? null,
              comments: m.comments ?? null,
              shares: m.shares ?? null,
              externalClicks: m.externalClicks ?? null,
            }))
          )
          if (!upsert.ok) {
            // metrics 보고 실패는 collect job 자체를 실패 처리하지 않는다 — 다음 sweep 에서 재시도.
            // 단, 에러는 로그로 남겨 운영 측이 인지할 수 있게 한다.
            console.warn(
              `[sc-runner] COLLECT_METRIC 결과 upsert 실패: ${upsert.errorMessage ?? 'unknown'}`
            )
          } else {
            console.log(`[sc-runner] COLLECT_METRIC metrics ${upsert.count}건 upsert 완료`)
          }
        }
      }
      return { ok: result.ok, errorMessage: result.errorMessage, errorCode: result.errorCode }
    }

    case 'INSIGHT_SWEEP': {
      try {
        const result = await deps.handleInsightSweep(c as Parameters<typeof handleInsightSweep>[0])
        // handler 가 ok:false + errorCode 미반환 시 PLATFORM_ERROR 로 기본 분류 (retry 허용).
        return {
          ok: result.ok,
          errorMessage: result.errorMessage,
          errorCode: result.ok ? undefined : 'PLATFORM_ERROR',
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[sc-runner] INSIGHT_SWEEP 예외: ${msg}`)
        return { ok: false, errorCode: 'PLATFORM_ERROR', errorMessage: msg }
      }
    }

    default: {
      const _exhaustive: never = kind
      return {
        ok: false,
        errorCode: 'NOT_IMPLEMENTED',
        errorMessage: `알 수 없는 job kind: ${_exhaustive}`,
      }
    }
  }
}

/** errorCode 기반 재시도 가능 여부 힌트 로깅. 정책은 webapp 의 isRetryableErrorCode 와 항상 일치해야 함. */
function logRetryHint(errorCode: string): void {
  // src/lib/sc/jobs.ts 의 RETRYABLE_ERROR_CODES 와 단일 진실 (NETWORK / PLATFORM_ERROR 만 retryable).
  const retryable = errorCode === 'NETWORK' || errorCode === 'PLATFORM_ERROR'
  if (retryable) {
    console.log(`[sc-runner] errorCode=${errorCode} — 재시도 가능 (네트워크/플랫폼 일시 오류)`)
  } else {
    console.log(
      `[sc-runner] errorCode=${errorCode} — 재시도 불필요 (자격증명·구현 문제, 운영 확인 필요)`
    )
  }
}

/** ClaimedJob → PublishContext 변환.
 * 웹앱 워커 API 가 deployment 에 content+channel 을 expand 해서 내려주므로 평탄화.
 * channel/content 가 없으면 null 반환 (deployment 미존재 = enqueue 후 삭제됐다는 의미).
 */
function buildPublishContext(c: ClaimedJob): PublishContext | null {
  const d = c.deployment
  if (!d?.channel || !d?.content) return null

  return {
    deployment: d,
    channel: d.channel,
    content: d.content,
    assets: c.assets ?? [],
    credential: c.credential ?? null,
    deploymentUrl: typeof c.deploymentUrl === 'string' ? c.deploymentUrl : '',
  }
}

/** ClaimedJob → CollectContext 변환. */
function buildCollectContext(c: ClaimedJob): CollectContext | null {
  const d = c.deployment
  if (!d?.channel) return null

  return {
    deployment: d,
    channel: d.channel,
    credential: c.credential ?? null,
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
