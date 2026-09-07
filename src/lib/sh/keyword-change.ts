// §26 변경 기록의 순수 계산부 — before/after 비교.
//
// 서버(API 라우트 3곳)와 클라이언트 양쪽에서 쓰이므로 런타임 의존성을 두지 않는다
// (keyword-* 전반의 규약 — keyword-normalize.ts 상단 주석 참조).

/**
 * Json 컬럼(ProductListing.keywords 등)에서 읽은 값을 검색어 배열로 정규화한다.
 *
 * Prisma 의 Json 은 무엇이든 들어올 수 있으므로 배열/문자열 여부를 모두 확인하고,
 * 앞뒤 공백만 다듬는다. **대소문자·순서는 건드리지 않는다** — 여기서는 "값이 실제로
 * 바뀌었는가"만 판단하며, 사용자가 대문자를 소문자로 고친 것도 진짜 변경이다.
 */
export function toKeywordList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string') continue
    const trimmed = v.trim()
    if (trimmed) out.push(trimmed)
  }
  return out
}

/**
 * 검색어가 바뀌었는지 — **집합 비교**다.
 * 순서만 바뀌거나 중복이 늘어난 것은 채널에 나가는 값이 같으므로 변경으로 보지 않는다.
 */
export function keywordsChanged(before: unknown, after: unknown): boolean {
  const b = new Set(toKeywordList(before))
  const a = new Set(toKeywordList(after))
  if (b.size !== a.size) return true
  for (const k of a) if (!b.has(k)) return true
  return false
}

/** 상품명이 바뀌었는지 — 공백만 다듬어 비교. null/undefined 는 빈 문자열과 같게 본다. */
export function nameChanged(before: string | null | undefined, after: string | null | undefined) {
  return (before ?? '').trim() !== (after ?? '').trim()
}

export type KeywordChangeDiffInput = {
  beforeName?: string | null
  afterName?: string | null
  beforeKeywords?: unknown
  afterKeywords?: unknown
}

export type KeywordChangeDiff = {
  /** 상품명이 바뀌었는가 */
  nameChanged: boolean
  /** 검색어 집합이 바뀌었는가 */
  keywordsChanged: boolean
  /** 둘 중 하나라도 바뀌었는가 — 이력을 남길지 판단하는 기준 */
  changed: boolean
  /**
   * §26 "가능하면 여러 요소를 동시에 바꾸지 않는다" — 상품명 AND 검색어 동시 변경.
   * 클라이언트가 보낸 값이 아니라 항상 이 함수로 계산한다.
   */
  multiChange: boolean
}

/** before/after 로부터 변경 여부와 multiChange 를 한 번에 판정한다. */
export function diffKeywordChange(input: KeywordChangeDiffInput): KeywordChangeDiff {
  const nameDiff = nameChanged(input.beforeName, input.afterName)
  const keywordDiff = keywordsChanged(input.beforeKeywords, input.afterKeywords)
  return {
    nameChanged: nameDiff,
    keywordsChanged: keywordDiff,
    changed: nameDiff || keywordDiff,
    multiChange: nameDiff && keywordDiff,
  }
}
