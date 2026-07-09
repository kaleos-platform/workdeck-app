// Blog Ops 워커 러너 — kind 별 라우팅 + 무한 polling 루프.
// sc/runner.ts 패턴 적용. deps 주입으로 테스트에서 mock 교체 가능.

import { pollOnce } from './job-poller.js'
import { getPublisher } from './publishers/index.js'
import { deleteNaverBlogPost } from './publishers/naver-blog-delete.js'
import type { BoClaimedJob } from './job-poller.js'
import type { BoPublishContext, BoDeleteContext } from './contracts.js'

type RouteResult = {
  ok: boolean
  errorMessage?: string
  errorCode?: string
  platformUrl?: string
}

export type BoRouteDeps = {
  getPublisher: typeof getPublisher
  deleteNaverBlogPost: typeof deleteNaverBlogPost
}

const realDeps: BoRouteDeps = { getPublisher, deleteNaverBlogPost }

/**
 * 단일 job 을 kind 에 따라 publisher/deleter 로 라우팅한다.
 * deps 를 주입받으므로 테스트에서 mock 교체 가능.
 * BoClaimedJob 이 discriminated union 이므로 c.job.kind 로 분기하고,
 * 각 branch 에서 c 를 해당 타입으로 직접 사용한다.
 */
export async function routeJob(
  c: BoClaimedJob,
  deps: BoRouteDeps = realDeps
): Promise<RouteResult> {
  const jobKind = c.job.kind
  switch (jobKind) {
    case 'PUBLISH': {
      // union 의 discriminant 가 중첩 프로퍼티라 TypeScript 가 c.context 를 자동 narrowing
      // 하지 못하므로 해당 branch 타입으로 명시 캐스팅한다.
      const ctx = c.context as BoPublishContext
      let publisher
      try {
        publisher = deps.getPublisher(ctx)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[bo-runner] Publisher factory 예외: ${msg}`)
        // factory 단계 실패 (플랫폼 미구현 등) — 영구 오류.
        return { ok: false, errorCode: 'NOT_IMPLEMENTED', errorMessage: msg }
      }
      try {
        const result = await publisher.publish(ctx)
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

    case 'DELETE_POST': {
      // union 의 discriminant 가 중첩 프로퍼티라 명시 캐스팅.
      const ctx = c.context as BoDeleteContext
      // DELETE_POST 는 현재 NAVER_BLOG 만 지원.
      if (ctx.channel.platform !== 'NAVER_BLOG') {
        return {
          ok: false,
          errorCode: 'NOT_IMPLEMENTED',
          errorMessage: `DELETE_POST 는 NAVER_BLOG 만 지원합니다 (platform: ${ctx.channel.platform})`,
        }
      }
      try {
        const result = await deps.deleteNaverBlogPost(ctx)
        if (!result.ok && result.errorCode) {
          console.warn(`[bo-runner] DELETE_POST 실패 [${result.errorCode}]: ${result.errorMessage}`)
        }
        return {
          ok: result.ok,
          errorMessage: result.errorMessage,
          errorCode: result.errorCode,
        }
      } catch (err) {
        // deleteNaverBlogPost() throw — 일시 오류로 간주, retry 허용.
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[bo-runner] deleteNaverBlogPost 예외: ${msg}`)
        return { ok: false, errorCode: 'PLATFORM_ERROR', errorMessage: msg }
      }
    }

    default: {
      const _exhaustive: never = jobKind
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
