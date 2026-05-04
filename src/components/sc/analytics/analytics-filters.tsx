'use client'

import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { SalesContentChannelKind, SalesContentPlatform } from '@/generated/prisma/client'

// ─── 레이블 맵 ─────────────────────────────────────────────────────────────

export const PLATFORM_LABEL: Record<SalesContentPlatform, string> = {
  BLOG_NAVER: '네이버 블로그',
  BLOG_TISTORY: '티스토리',
  BLOG_WORDPRESS: '워드프레스',
  THREADS: 'Threads',
  X: 'X (트위터)',
  LINKEDIN: 'LinkedIn',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  YOUTUBE_SHORTS: 'YouTube Shorts',
  OTHER: '기타',
}

const KIND_LABEL: Record<SalesContentChannelKind, string> = {
  BLOG: '블로그',
  SOCIAL: '소셜',
}

// ─── 타입 ──────────────────────────────────────────────────────────────────

export interface AnalyticsFiltersValue {
  kind: SalesContentChannelKind | 'ALL'
  platforms: SalesContentPlatform[]
  channelIds: string[]
  search: string
}

export interface ChannelOption {
  id: string
  name: string
  platform: SalesContentPlatform
  kind: SalesContentChannelKind
}

interface Props {
  /** 실제 등록된 채널 목록 (unique) */
  channels: ChannelOption[]
  value: AnalyticsFiltersValue
  onChange: (next: AnalyticsFiltersValue) => void
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────

const ALL_PLATFORMS = Object.keys(PLATFORM_LABEL) as SalesContentPlatform[]

export function AnalyticsFilters({ channels, value, onChange }: Props) {
  function setKind(kind: SalesContentChannelKind | 'ALL') {
    onChange({ ...value, kind })
  }

  function togglePlatform(p: SalesContentPlatform) {
    const next = value.platforms.includes(p)
      ? value.platforms.filter((x) => x !== p)
      : [...value.platforms, p]
    onChange({ ...value, platforms: next })
  }

  function toggleChannel(id: string) {
    const next = value.channelIds.includes(id)
      ? value.channelIds.filter((x) => x !== id)
      : [...value.channelIds, id]
    onChange({ ...value, channelIds: next })
  }

  function setSearch(search: string) {
    onChange({ ...value, search })
  }

  const kinds: Array<SalesContentChannelKind | 'ALL'> = ['ALL', 'BLOG', 'SOCIAL']

  return (
    <div className="flex flex-col gap-3">
      {/* 검색 */}
      <Input
        placeholder="제목 검색…"
        value={value.search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8 max-w-xs text-sm"
        aria-label="콘텐츠 제목 검색"
      />

      <div className="flex flex-wrap items-center gap-4">
        {/* 유형 토글 */}
        <div className="flex items-center gap-1" role="group" aria-label="콘텐츠 유형 필터">
          {kinds.map((k) => {
            const active = value.kind === k
            return (
              <button
                key={k}
                onClick={() => setKind(k)}
                aria-pressed={active}
                className={[
                  'rounded-md px-2.5 py-1 text-xs font-medium transition',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                ].join(' ')}
              >
                {k === 'ALL' ? '전체' : KIND_LABEL[k]}
              </button>
            )
          })}
        </div>

        {/* 플랫폼 멀티셀렉트 */}
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="플랫폼 필터">
          {ALL_PLATFORMS.map((p) => {
            const selected = value.platforms.includes(p)
            return (
              <button
                key={p}
                onClick={() => togglePlatform(p)}
                aria-pressed={selected}
                className={[
                  'rounded-md border px-2 py-0.5 text-xs transition',
                  selected
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:border-primary/30 hover:text-foreground',
                ].join(' ')}
              >
                {PLATFORM_LABEL[p]}
              </button>
            )
          })}
        </div>

        {/* 채널 멀티셀렉트 */}
        {channels.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="채널 필터">
            {channels.map((ch) => {
              const selected = value.channelIds.includes(ch.id)
              return (
                <button
                  key={ch.id}
                  onClick={() => toggleChannel(ch.id)}
                  aria-pressed={selected}
                  className={[
                    'rounded-md border px-2 py-0.5 text-xs transition',
                    selected
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:border-primary/30 hover:text-foreground',
                  ].join(' ')}
                >
                  {ch.name}
                </button>
              )
            })}
          </div>
        )}

        {/* 활성 필터 요약 배지 */}
        {(value.platforms.length > 0 || value.channelIds.length > 0) && (
          <button
            onClick={() => onChange({ ...value, platforms: [], channelIds: [] })}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            aria-label="플랫폼·채널 필터 초기화"
          >
            초기화
          </button>
        )}
      </div>

      {/* 선택된 플랫폼/채널 요약 (선택 시만 표시) */}
      {(value.platforms.length > 0 || value.channelIds.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {value.platforms.map((p) => (
            <Badge
              key={p}
              variant="secondary"
              className="cursor-pointer text-xs"
              onClick={() => togglePlatform(p)}
            >
              {PLATFORM_LABEL[p]} ×
            </Badge>
          ))}
          {value.channelIds.map((id) => {
            const ch = channels.find((c) => c.id === id)
            if (!ch) return null
            return (
              <Badge
                key={id}
                variant="secondary"
                className="cursor-pointer text-xs"
                onClick={() => toggleChannel(id)}
              >
                {ch.name} ×
              </Badge>
            )
          })}
        </div>
      )}
    </div>
  )
}
