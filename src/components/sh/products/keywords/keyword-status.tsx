'use client'

import { Ban, MinusCircle, Search, SlidersHorizontal, Sparkles, Tag } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { KEYWORD_STATUS_LABELS } from '@/lib/sh/keyword-labels'
import type { KeywordMasterStatus } from '@/generated/prisma/enums'

export type KeywordStatus = KeywordMasterStatus

/**
 * 상태 배지 스타일 — 색만으로 구분하지 않도록 상태마다 아이콘을 함께 붙인다.
 *
 * 시각 구분 원칙:
 * - BANNED(금지)만 solid red. 목록에서 즉시 튀어야 하는 유일한 상태다.
 * - EXCLUDED(제외)는 amber 채움 — "쓰지 않음"이지만 금지와는 다른 층위임을 색·아이콘으로 분리.
 * - CANDIDATE(후보)는 점선 테두리 회색 = 아직 확정 전. 실사용 상태(SEARCH_TERM 등)와
 *   채움/테두리 형태 자체가 달라 색맹 조건에서도 구분된다.
 */
const STATUS_STYLE: Record<KeywordStatus, { className: string; icon: LucideIcon }> = {
  PRODUCT_NAME: {
    className: 'border-indigo-300 bg-indigo-50 text-indigo-900',
    icon: Tag,
  },
  SEARCH_TERM: {
    className: 'border-sky-400 bg-sky-100 text-sky-900',
    icon: Search,
  },
  SEARCH_OPTION: {
    className: 'border-teal-300 bg-teal-50 text-teal-900',
    icon: SlidersHorizontal,
  },
  CANDIDATE: {
    className: 'border-dashed border-slate-400 bg-transparent text-slate-600',
    icon: Sparkles,
  },
  EXCLUDED: {
    className: 'border-amber-400 bg-amber-100 text-amber-900',
    icon: MinusCircle,
  },
  BANNED: {
    className: 'border-red-700 bg-red-600 text-white',
    icon: Ban,
  },
}

/** 배지 className 만 필요할 때(중복 패널 등) */
export function statusBadgeClass(status: KeywordStatus) {
  return STATUS_STYLE[status]?.className ?? ''
}

export function KeywordStatusBadge({ status }: { status: KeywordStatus }) {
  const style = STATUS_STYLE[status]
  if (!style) return <Badge variant="outline">{status}</Badge>
  const Icon = style.icon
  return (
    <Badge variant="outline" className={`gap-1 text-[11px] ${style.className}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {KEYWORD_STATUS_LABELS[status]}
    </Badge>
  )
}
