// Threads API 수집기 스켈레톤 — insights endpoint 호출 예정.
// https://developers.facebook.com/docs/threads/insights

import type { CollectContext, CollectResult, Collector } from './index'

export class ThreadsApiCollector implements Collector {
  readonly name = 'threads-api'

  async collect(ctx: CollectContext): Promise<CollectResult> {
    const token =
      typeof ctx.credential?.payload?.accessToken === 'string'
        ? (ctx.credential.payload.accessToken as string)
        : null
    if (!token) {
      return {
        ok: false,
        errorMessage: 'Threads accessToken 이 저장되지 않았습니다',
      }
    }
    if (!ctx.deployment.platformUrl) {
      return {
        ok: false,
        errorMessage: 'platformUrl 이 아직 채워지지 않았습니다 (배포 성공 후 수집 가능)',
      }
    }
    // PoC 스켈레톤: 실제 insights API 호출은 토큰 발급 후.
    return {
      ok: false,
      errorMessage:
        'Threads API 수집기는 아직 구현되지 않음 (Phase 2). 수동 입력으로 대체하거나 collectorMode=MANUAL 로 전환.',
    }
  }
}
