'use client'

// 상품명 재변경 경고 — 직전 상품명 변경이 COOLDOWN_DAYS 이내인데 또 바꾸려 할 때만 띄운다.
// 막지 않는다(비차단). 변경 효과는 전/후 기간을 비교해야 보이는데, 그 기간 안에 다시 바꾸면
// 어느 변경이 효과를 냈는지 분리할 수 없다는 점만 알려준다.

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

import { nameChanged } from '@/lib/sh/keyword-change'

export const COOLDOWN_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

type Props = {
  /** 이력 조회 대상 — 하나 이상. 이력 GET 은 이 조건들을 OR 로 묶는다. */
  listingId?: string | null
  channelProductId?: string | null
  /** 저장된 상품명 — 저장으로 바뀌면 이력을 다시 조회한다. */
  savedName: string
  /** 상품명을 저장값과 다르게 고친 상태일 때만 true — 그 전에는 조회도 하지 않는다. */
  editing: boolean
}

type ChangeRow = { beforeName: string | null; afterName: string | null; createdAt: string }

export function NameChangeCooldownNotice({
  listingId,
  channelProductId,
  savedName,
  editing,
}: Props) {
  const query = new URLSearchParams()
  if (listingId) query.set('listingId', listingId)
  if (channelProductId) query.set('channelProductId', channelProductId)
  query.set('pageSize', '50')
  const queryKey = listingId || channelProductId ? query.toString() : ''

  // 어떤 조회에 대한 결과인지 함께 둔다 — 대상·저장값이 바뀌면 다시 조회한다.
  const resultKey = `${queryKey}|${savedName}`
  const [result, setResult] = useState<{ key: string; days: number | null }>({
    key: '',
    days: null,
  })

  useEffect(() => {
    if (!editing || !queryKey || result.key === resultKey) return
    let cancelled = false
    fetch(`/api/sh/keywords/changes?${queryKey}`)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((json: { data?: ChangeRow[] }) => {
        // 최신순이다 — 상품명이 실제로 바뀐 첫 행이 직전 변경이다(키워드만 바꾼 행은 건너뛴다).
        const last = (json.data ?? []).find((r) => nameChanged(r.beforeName, r.afterName))
        const days = last
          ? Math.floor((Date.now() - new Date(last.createdAt).getTime()) / DAY_MS)
          : null
        if (!cancelled) setResult({ key: resultKey, days })
      })
      .catch(() => {}) // 부가 경고라 실패는 조용히 무시한다
    return () => {
      cancelled = true
    }
  }, [editing, queryKey, resultKey, result.key])

  const { days } = result
  if (!editing || result.key !== resultKey || days === null || days >= COOLDOWN_DAYS) return null

  return (
    <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        상품명이 {days === 0 ? '오늘' : `${days}일 전에`} 바뀌었습니다. 변경 효과는 전후{' '}
        {COOLDOWN_DAYS}일을 비교해야 보입니다 — 그 전에 다시 바꾸면 어느 변경의 효과인지 구분할 수
        없습니다.
      </span>
    </p>
  )
}
