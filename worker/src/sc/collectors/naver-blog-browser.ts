// 네이버 블로그 통계 수집기 스켈레톤 — Playwright 로 블로그 관리 페이지 스크랩.
// 실제 흐름:
//   1. storageState 주입 브라우저로 관리자 통계 페이지 진입.
//   2. 오늘 지표 (방문·조회·좋아요·댓글) 스크랩.
//   3. DeploymentMetric upsert.

import type { CollectContext, CollectResult, Collector } from './index'

export class NaverBlogBrowserCollector implements Collector {
  readonly name = 'naver-blog-browser'

  async collect(ctx: CollectContext): Promise<CollectResult> {
    if (!ctx.credential?.payload?.storageState) {
      return { ok: false, errorMessage: '네이버 블로그 storageState 가 없습니다' }
    }
    if (!ctx.deployment.platformUrl) {
      return { ok: false, errorMessage: 'platformUrl 이 없어 스크랩할 대상이 없습니다' }
    }
    return {
      ok: false,
      errorMessage:
        '네이버 블로그 Playwright 수집기는 아직 구현되지 않음 (Phase 2). 수동 입력으로 대체하거나 collectorMode=MANUAL 로 전환.',
    }
  }
}
