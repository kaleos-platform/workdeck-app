'use client'

/**
 * 「규칙으로 저장」 시 기존 규칙과의 관계 안내 — /api/finance/rules/lookup 조회(확인 팝업 경고용).
 * params 가 null 이면(규칙 저장 해제·계정과목 미변경) 조회하지 않는다.
 */
import { useEffect, useState } from 'react'

export type RuleNoticeView = {
  kind: 'REPLACED' | 'OVERRIDES'
  fromCategoryId: string
  fromLabel: string
}

export type RuleNoticeParams = {
  accountId: string
  direction: 'IN' | 'OUT'
  description: string | null
  counterparty: string | null
  categoryId: string
}

export function useRuleNotice(params: RuleNoticeParams | null): RuleNoticeView | null {
  // 결과를 조회 키와 함께 보관 — 키가 바뀌면(또는 null) 이전 결과는 자동으로 무시된다.
  const [result, setResult] = useState<{ key: string; notice: RuleNoticeView | null } | null>(null)
  const key = params ? JSON.stringify(params) : ''

  useEffect(() => {
    if (!key) return
    const p = JSON.parse(key) as RuleNoticeParams
    const qs = new URLSearchParams({
      accountId: p.accountId,
      direction: p.direction,
      description: p.description ?? '',
      counterparty: p.counterparty ?? '',
      categoryId: p.categoryId,
    })
    const ctrl = new AbortController()
    fetch(`/api/finance/rules/lookup?${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { notice: null }))
      .then((j) => setResult({ key, notice: j.notice ?? null }))
      .catch(() => {})
    return () => ctrl.abort()
  }, [key])

  return key && result?.key === key ? result.notice : null
}

/** 경고·토스트 문구. toLabel = 새로 저장할 계정과목 라벨. */
export function ruleNoticeText(n: RuleNoticeView, toLabel: string): string {
  return n.kind === 'REPLACED'
    ? `이 계좌의 규칙 〈${n.fromLabel}〉이(가) 〈${toLabel}〉(으)로 변경됩니다`
    : `이 계좌에 새 규칙 〈${toLabel}〉이(가) 생겨 기존 규칙 〈${n.fromLabel}〉 대신 적용됩니다`
}
