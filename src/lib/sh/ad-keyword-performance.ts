// 쿠팡 광고 검색어 성과 × 등록 키워드 — 순수 계산부(DB 무관). 로더는 ad-keyword-performance-query.ts.
import { despaceKeyword, splitTokens } from '@/lib/sh/keyword-normalize'

export type AdTermAgg = { term: string; imp: number; clk: number; ord: number; cost: number }
export type KeywordAdStat = { imp: number; clk: number; ord: number }
export type DiscoverWord = {
  word: string
  orders: number
  clicks: number
  terms: number
  examples: string[]
}
export type AdKeywordPerformance = {
  keywordStats: Record<string, KeywordAdStat>
  discover: DiscoverWord[]
  prune: string[]
}

const DISCOVER_LIMIT = 20
/** 노출 합계가 이보다 적으면 0 노출 키워드가 표본 부족일 뿐이라 정리 후보를 내지 않는다. */
export const PRUNE_MIN_IMPRESSIONS = 1000
const EXAMPLE_LIMIT = 3

/** 한 글자 조각은 영숫자·% 만 허용 — '선크림' 이 '선' + '크림' 으로 덮이는 오탐을 막는다. */
const SINGLE_OK = /^[0-9a-z%]$/

/** 단어가 코퍼스에 통째로 있거나, 코퍼스에 있는 조각(2자 이상)들로 남김없이 쪼개지면 덮인 것. */
export function isWordCovered(word: string, corpus: string): boolean {
  if (!word) return true
  if (corpus.includes(word)) return true
  const n = word.length
  const reach = new Array<boolean>(n + 1).fill(false)
  reach[0] = true
  for (let i = 1; i <= n; i += 1) {
    for (let j = 0; j < i && !reach[i]; j += 1) {
      if (!reach[j]) continue
      const piece = word.slice(j, i)
      if ((piece.length >= 2 || SINGLE_OK.test(piece)) && corpus.includes(piece)) reach[i] = true
    }
  }
  return reach[n]
}

export function computeAdKeywordPerformance(input: {
  terms: AdTermAgg[]
  name: string
  keywords: string[]
}): AdKeywordPerformance {
  const corpus = despaceKeyword([input.name, ...input.keywords].join(' '))
  const normTerms = input.terms.map((t) => ({ ...t, key: despaceKeyword(t.term) }))

  const keywordStats: Record<string, KeywordAdStat> = {}
  for (const kw of input.keywords) {
    const key = despaceKeyword(kw)
    if (!key || keywordStats[kw]) continue
    const stat = { imp: 0, clk: 0, ord: 0 }
    for (const t of normTerms) {
      if (!t.key.includes(key)) continue
      stat.imp += t.imp
      stat.clk += t.clk
      stat.ord += t.ord
    }
    keywordStats[kw] = stat
  }

  const words = new Map<string, DiscoverWord>()
  for (const t of input.terms) {
    if (t.clk <= 0) continue
    // 한 검색어 안에서 같은 단어가 반복돼도 한 번만 센다.
    for (const word of new Set(splitTokens(t.term).map(despaceKeyword))) {
      if (!word || isWordCovered(word, corpus)) continue
      let w = words.get(word)
      if (!w) words.set(word, (w = { word, orders: 0, clicks: 0, terms: 0, examples: [] }))
      w.orders += t.ord
      w.clicks += t.clk
      w.terms += 1
      if (w.examples.length < EXAMPLE_LIMIT) w.examples.push(t.term)
    }
  }
  const discover = [...words.values()]
    .filter((w) => w.orders > 0)
    .sort((a, b) => b.orders - a.orders || b.clicks - a.clicks)
    .slice(0, DISCOVER_LIMIT)

  const totalImp = input.terms.reduce((sum, t) => sum + t.imp, 0)
  const prune =
    totalImp < PRUNE_MIN_IMPRESSIONS
      ? []
      : Object.entries(keywordStats)
          .filter(([, s]) => s.imp === 0)
          .map(([kw]) => kw)

  return { keywordStats, discover, prune }
}
