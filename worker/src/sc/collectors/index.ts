// Collector factory — 채널 플랫폼 · collectorMode 조합으로 수집기 선택.
// 결과는 일자 단위 DeploymentMetric 으로 upsert.

export interface CollectContext {
  deployment: {
    id: string
    platformUrl: string | null
    shortSlug: string
  }
  channel: {
    id: string
    platform: string
    collectorMode: 'API' | 'BROWSER' | 'MANUAL' | 'NONE'
    config: unknown
  }
  credential?: { payload: Record<string, unknown> } | null
}

export interface CollectedMetric {
  date: Date
  impressions?: number
  views?: number
  likes?: number
  comments?: number
  shares?: number
  externalClicks?: number
}

export interface CollectResult {
  ok: boolean
  metrics?: CollectedMetric[]
  errorMessage?: string
}

export interface Collector {
  readonly name: string
  collect(ctx: CollectContext): Promise<CollectResult>
}

import { ThreadsApiCollector } from './threads-api'
import { NaverBlogBrowserCollector } from './naver-blog-browser'

export function getCollector(ctx: CollectContext): Collector | null {
  if (ctx.channel.collectorMode === 'NONE' || ctx.channel.collectorMode === 'MANUAL') {
    return null
  }
  if (ctx.channel.platform === 'THREADS' && ctx.channel.collectorMode === 'API') {
    return new ThreadsApiCollector()
  }
  if (ctx.channel.platform === 'BLOG_NAVER' && ctx.channel.collectorMode === 'BROWSER') {
    return new NaverBlogBrowserCollector()
  }
  return null
}

export { ThreadsApiCollector } from './threads-api'
export { NaverBlogBrowserCollector } from './naver-blog-browser'
