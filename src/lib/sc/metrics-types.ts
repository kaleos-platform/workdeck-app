/**
 * UI ↔ Bernstein 함수 구현 동기화용 타입 계약.
 * 이 파일은 Bernstein 의 metrics.ts 구현과 별도로 관리한다.
 * Bernstein 이 getSpaceContentAnalytics / getContentMetricsTotal 을 구현할 때
 * 이 파일의 인터페이스와 일치시킨다.
 */

import type {
  ContentStatus,
  SalesContentChannelKind,
  SalesContentPlatform,
} from '@/generated/prisma/client'

// ─── 성과 관리 테이블 ─────────────────────────────────────────────────────────

/** 성과 관리 테이블의 콘텐츠 단위 행 */
export interface SpaceContentAnalyticsRow {
  id: string
  title: string
  status: ContentStatus
  /** 배포된 채널 목록 (중복 제거) */
  channels: Array<{
    id: string
    name: string
    platform: SalesContentPlatform
    kind: SalesContentChannelKind
  }>
  /** 가장 최근 게시일 (publishedAt 기준, null = 미게시) */
  latestPublishedAt: Date | null
  /** 모든 배포의 지표 합계 */
  metrics: {
    impressions: number
    views: number
    likes: number
    internalClicks: number // ContentClickEvent 건수
    externalClicks: number
  }
}

// ─── 콘텐츠 상세 ──────────────────────────────────────────────────────────────

/** 콘텐츠 상세 페이지의 합계 + 배포별 분해 */
export interface ContentMetricsTotal {
  total: {
    impressions: number
    views: number
    likes: number
    comments: number
    internalClicks: number
    externalClicks: number
    channelCount: number
  }
  byDeployment: Array<{
    deploymentId: string
    shortSlug: string
    publishedAt: Date | null
    channel: {
      id: string
      name: string
      platform: SalesContentPlatform
      kind: SalesContentChannelKind
    }
    metrics: {
      impressions: number
      views: number
      likes: number
      comments: number
      internalClicks: number
      externalClicks: number
    }
  }>
}
