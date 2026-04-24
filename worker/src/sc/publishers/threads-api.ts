// Threads API 퍼블리셔 스켈레톤.
// 실제 엔드포인트: https://graph.threads.net/v1.0/{IG_USER_ID}/threads + ...
// 자격증명: ChannelCredential.kind=OAUTH 의 accessToken.
// 현재는 PoC 로 최소 구조만 잡고, 실제 API 심사/통합은 후속.

import type { Publisher, PublishContext, PublishResult } from './index'

export class ThreadsApiPublisher implements Publisher {
  readonly name = 'threads-api'

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const token =
      typeof ctx.credential?.payload?.accessToken === 'string'
        ? (ctx.credential.payload.accessToken as string)
        : null
    if (!token) {
      return {
        ok: false,
        errorMessage: 'Threads accessToken 이 저장되지 않았습니다 (채널 자격증명 등록 필요)',
      }
    }

    // ⚠️ PoC 스켈레톤: 실제 Threads API 호출은 외부 심사·토큰 발급 후.
    // 현재는 "도달했지만 구현되지 않음" 상태 반환.
    return {
      ok: false,
      errorMessage:
        'Threads API 퍼블리셔는 아직 구현되지 않음 (Phase 2 또는 Unit 10 후속). 현재는 MANUAL 로 전환해 사용하세요.',
    }
  }
}
