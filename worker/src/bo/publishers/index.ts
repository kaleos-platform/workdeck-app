// Bo Publisher factory — 채널 플랫폼으로 publisher 를 선택.
// OWN_HOMEPAGE 는 워커 자동 발행 불가 — 에러 throw.

import type { BoPublishContext, BoChannelPlatform } from '../contracts.js'

export type BoPublishErrorCode =
  | 'AUTH_FAILED'
  | 'LOGIN_EXPIRED'
  | 'EDITOR_NOT_FOUND'
  | 'PUBLISH_FAILED'
  | 'URL_CAPTURE_FAILED'
  | 'NOT_IMPLEMENTED'
  | 'VALIDATION'
  | 'PLATFORM_ERROR'
  | 'NETWORK'

export interface BoPublishResult {
  ok: boolean
  platformUrl?: string
  errorMessage?: string
  errorCode?: BoPublishErrorCode
}

export interface BoPublisher {
  readonly name: string
  publish(ctx: BoPublishContext): Promise<BoPublishResult>
}

import { NaverBlogBrowserPublisher } from './naver-blog-browser.js'
import { TistoryBrowserPublisher } from './tistory-browser.js'

export function getPublisher(ctx: BoPublishContext): BoPublisher {
  const platform: BoChannelPlatform = ctx.channel.platform
  switch (platform) {
    case 'NAVER_BLOG':
      return new NaverBlogBrowserPublisher()
    case 'TISTORY':
      return new TistoryBrowserPublisher()
    case 'OWN_HOMEPAGE':
      throw new Error(
        'OWN_HOMEPAGE 은 워커를 통한 자동 발행을 지원하지 않습니다 (not publishable via worker)'
      )
    default: {
      const _exhaustive: never = platform
      throw new Error(`Publisher 가 구현되지 않음: ${_exhaustive}`)
    }
  }
}

export { NaverBlogBrowserPublisher } from './naver-blog-browser.js'
export { TistoryBrowserPublisher } from './tistory-browser.js'
