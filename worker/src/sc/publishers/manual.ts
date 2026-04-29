// 수동 게시 — 워커는 즉시 성공으로 표시하고 실제 게시는 사용자가 외부 플랫폼에서 수행.
// 이후 사용자는 UI 에서 platformUrl 을 수동 입력해 업데이트한다.

import type { Publisher, PublishContext, PublishResult } from './index'

export class ManualPublisher implements Publisher {
  readonly name = 'manual'
  async publish(_ctx: PublishContext): Promise<PublishResult> {
    return { ok: true }
  }
}
