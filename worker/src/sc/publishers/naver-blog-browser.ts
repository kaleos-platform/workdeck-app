// 네이버 블로그 브라우저 자동화 퍼블리셔 — Playwright storageState 기반.
// 현재는 PoC 스켈레톤. 실제 Playwright 흐름은 다음과 같이 전개된다:
//   1. chromium.launchPersistentContext 로 brower 세션을 연다.
//   2. storageState 를 주입해 로그인 유지.
//   3. 블로그 글쓰기 페이지로 이동 → 제목 입력 → 에디터 iframe 에 내용 주입.
//   4. 발행 버튼 클릭 → 성공 URL 획득.
//
// 캡챠/2FA 발생 시 즉시 실패 + 사용자 headful 재로그인 알림.

import type { Publisher, PublishContext, PublishResult } from './index'

export class NaverBlogBrowserPublisher implements Publisher {
  readonly name = 'naver-blog-browser'

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const storageState = ctx.credential?.payload?.storageState
    if (!storageState) {
      return {
        ok: false,
        errorMessage:
          '네이버 블로그 자격증명(storageState)이 없습니다. 채널 자격증명을 등록하거나 수동 재로그인이 필요합니다.',
      }
    }
    return {
      ok: false,
      errorMessage:
        '네이버 블로그 Playwright 자동화는 아직 구현되지 않음 (Phase 2). 현재는 MANUAL 로 전환해 사용하세요.',
    }
  }
}
