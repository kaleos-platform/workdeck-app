// Blog Ops 워커 러너 — kind 별 라우팅 + 무한 polling 루프.
// sc/runner.ts 패턴 적용. deps 주입으로 테스트에서 mock 교체 가능.

import { pollOnce } from './job-poller.js'
import { getPublisher } from './publishers/index.js'
import type { BoClaimedJob } from './job-poller.js'

type RouteResult = {
  ok: boolean
  errorMessage?: string
  errorCode?: string
  platformUrl?: string
}

export type BoRouteDeps = {
  getPublisher: typeof getPublisher
}

const realDeps: BoRouteDeps = { getPublisher }

/**
 * 단일 job 을 kind 에 따라 publisher 로 라우팅한다.
 * deps 를 주입받으므로 테스트에서 mock 교체 가능.
 */
export async function routeJob(
  c: BoClaimedJob,
  deps: BoRouteDeps = realDeps
): Promise<RouteResult> {
  const { kind } = c.job

  switch (kind) {
    case 'PUBLISH': {
      let publisher
      try {
        publisher = deps.getPublisher(c.context)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[bo-runner] Publisher factory 예외: ${msg}`)
        // factory 단계 실패 (플랫폼 미구현 등) — 영구 오류.
        return { ok: false, errorCode: 'NOT_IMPLEMENTED', errorMessage: msg }
      }
      try {
        const result = await publisher.publish(c.context)
        if (!result.ok && result.errorCode) {
          console.warn(
            `[bo-runner] PUBLISH 실패 [${result.errorCode}] ${publisher.name}: ${result.errorMessage}`
          )
        }
        return {
          ok: result.ok,
          errorMessage: result.errorMessage,
          errorCode: result.errorCode,
          platformUrl: result.platformUrl,
        }
      } catch (err) {
        // publisher.publish() throw — 일시 오류로 간주, retry 허용.
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[bo-runner] Publisher.publish 예외: ${msg}`)
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

/** bo 워커 무한 polling 루프. SIGTERM/SIGINT 로 graceful shutdown. */
export async function runBoLoop(options?: { intervalMs?: number }): Promise<void> {
  const intervalMs = options?.intervalMs ?? 5_000

  let stopped = false
  const shutdown = () => {
    if (!stopped) {
      console.log('[bo-runner] shutdown signal 수신 — 다음 poll 후 종료')
      stopped = true
    }
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  console.log('[bo-runner] bo worker started')

  while (!stopped) {
    try {
      const { processed, failed } = await pollOnce((c) => routeJob(c, realDeps))
      if (processed + failed > 0) {
        console.log(`[bo-runner] poll 완료 — processed=${processed}, failed=${failed}`)
      }
    } catch (err) {
      console.error('[bo-runner] poll 오류 (재시도):', err instanceof Error ? err.message : err)
    }

    if (!stopped) {
      await sleep(intervalMs)
    }
  }

  console.log('[bo-runner] bo worker stopped')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
