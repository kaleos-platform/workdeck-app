// 상품 검색어 토큰화 — 재고 조정 수동 매칭 픽커의 키워드 칩과
// /api/sh/products 의 tokenized AND 검색이 같은 규칙을 쓰도록 공용화한다.
// (서버·클라이언트 양쪽에서 import 하므로 순수 함수만 둔다)

/** 토큰 구분자 — 검색어 검증기(src/lib/sh/keyword-*)가 같은 분해 규칙을 쓰도록 공개한다. */
export const SEPARATOR = /[\s/,()[\]{}·|+_-]+/
const MAX_TOKENS = 12

/**
 * 상품명을 검색 토큰 배열로 분해한다.
 * - 구분자(공백·슬래시·괄호·쉼표·하이픈 등)로 분리
 * - 빈 값·중복 제거, 원래 순서 보존
 * - 기본 최대 12개 (긴 상품명이 쿼리를 과도하게 키우는 것 방지)
 *
 * @param maxTokens 상한 재정의. /api/sh/products 의 tokenized AND 검색은 기본값 12에
 *   의존하므로 절대 바꾸지 않는다. 검증 목적으로 전체 토큰이 필요하면
 *   `Number.POSITIVE_INFINITY` 를 넘긴다(13번째 이후 단어와의 중복도 잡아야 하므로).
 */
export function tokenizeProductName(raw: string, maxTokens = MAX_TOKENS): string[] {
  const tokens: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(SEPARATOR)) {
    const token = part.trim()
    if (!token) continue
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tokens.push(token)
    if (tokens.length >= maxTokens) break
  }
  return tokens
}
