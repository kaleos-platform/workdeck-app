// Publisher factory — 채널 플랫폼 · publisherMode 조합으로 publisher 를 선택.
// 실제 플랫폼 통합은 각 구현체에서 점진적으로 채운다 (Phase 1 PoC 이후).

export interface PublishContext {
  deployment: {
    id: string
    targetUrl: string
    shortSlug: string
    utmSource: string | null
    utmMedium: string | null
    utmCampaign: string | null
  }
  channel: {
    id: string
    name: string
    platform:
      | 'BLOG_NAVER'
      | 'BLOG_TISTORY'
      | 'BLOG_WORDPRESS'
      | 'THREADS'
      | 'X'
      | 'LINKEDIN'
      | 'FACEBOOK'
      | 'INSTAGRAM'
      | 'YOUTUBE_SHORTS'
      | 'OTHER'
    publisherMode: 'API' | 'BROWSER' | 'MANUAL'
    config: unknown
  }
  content: {
    id: string
    title: string
    doc: unknown
  }
  assets: Array<{ slotKey: string | null; url: string; alt: string | null }>
  credential?: {
    payload: Record<string, unknown>
  } | null
  // /c/{slug} 최종 링크 — CTA 슬롯에 주입됨
  deploymentUrl: string
}

// 재시도 가능 여부 판단에 사용하는 에러 코드.
// AUTH_FAILED / RATE_LIMITED 는 재시도 불필요(자격증명 갱신 필요),
// NETWORK / PLATFORM_ERROR 는 재시도 가능.
export type PublishErrorCode =
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'VALIDATION'
  | 'PLATFORM_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'NETWORK'

export interface PublishResult {
  ok: boolean
  platformUrl?: string
  errorMessage?: string
  errorCode?: PublishErrorCode
}

export interface Publisher {
  readonly name: string
  publish(ctx: PublishContext): Promise<PublishResult>
}

import { ThreadsApiPublisher } from './threads-api'
import { NaverBlogBrowserPublisher } from './naver-blog-browser'
import { ManualPublisher } from './manual'

// publisherMode=MANUAL 이면 ManualPublisher 로 즉시 성공 마킹(사용자가 외부 URL 나중에 입력).
// 아니면 (platform, mode) 조합에 맞는 어댑터. 매치 없으면 에러.
export function getPublisher(ctx: PublishContext): Publisher {
  if (ctx.channel.publisherMode === 'MANUAL') return new ManualPublisher()

  if (ctx.channel.platform === 'THREADS' && ctx.channel.publisherMode === 'API') {
    return new ThreadsApiPublisher()
  }
  if (ctx.channel.platform === 'BLOG_NAVER' && ctx.channel.publisherMode === 'BROWSER') {
    return new NaverBlogBrowserPublisher()
  }
  throw new Error(
    `Publisher 가 구현되지 않음: ${ctx.channel.platform} / ${ctx.channel.publisherMode}`
  )
}

export { ThreadsApiPublisher } from './threads-api'
export { NaverBlogBrowserPublisher } from './naver-blog-browser'
export { ManualPublisher } from './manual'
