// 주간 키워드 리뷰 — 순수 계산부(DB 무관): 거절 이력 억제, 키워드 묶음 집합 연산.
import { despaceKeyword, normalizeKeyword } from '@/lib/sh/keyword-normalize'
import { MAX_KEYWORDS } from '@/lib/sh/schemas'

/** 거절된 제안에 있던 단어를 후보에서 뺀다(띄어쓰기 무시 비교). */
export function suppressRejected<T>(
  items: T[],
  wordOf: (item: T) => string,
  rejectedWords: string[]
): { kept: T[]; suppressed: string[] } {
  const blocked = new Set(rejectedWords.map(despaceKeyword))
  const kept: T[] = []
  const suppressed: string[] = []
  for (const it of items) {
    if (blocked.has(despaceKeyword(wordOf(it)))) suppressed.push(wordOf(it))
    else kept.push(it)
  }
  return { kept, suppressed }
}

/**
 * 현재 키워드에 추가·삭제를 적용한다 — 정규화 형태로 비교.
 * 삭제 먼저, 그 뒤 현재에 없는 추가만 덧붙인다. 한도 초과는 부분 적용 없이 에러.
 */
export function applyKeywordOps(
  current: string[],
  add: string[],
  remove: string[],
  limit = MAX_KEYWORDS
): { ok: true; keywords: string[] } | { ok: false; message: string } {
  const drop = new Set(remove.map(normalizeKeyword))
  const out = current.filter((k) => !drop.has(normalizeKeyword(k)))
  const seen = new Set(out.map(normalizeKeyword))
  for (const a of add) {
    const t = a.trim()
    const n = normalizeKeyword(t)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(t)
  }
  if (out.length > limit) {
    return { ok: false, message: `키워드가 ${limit}개를 넘습니다 (적용 후 ${out.length}개)` }
  }
  return { ok: true, keywords: out }
}
