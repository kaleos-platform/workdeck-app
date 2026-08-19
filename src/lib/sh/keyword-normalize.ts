// 검색어 비교용 정규화 키 — 쿠팡 상품명/검색어 운영 가이드 §11(띄어쓰기 중복),
// §12(단어 순서 조합 반복) 탐지에 쓴다.
//
// tokenizeProductName 은 공백을 "구분자로 소비"하므로
//   "호텔 타월" → ["호텔","타월"],  "호텔타월" → ["호텔타월"]
// 이 되어 두 표기가 절대 충돌하지 않는다. 그래서 별도의 비교 키가 필요하다.
// (서버·클라이언트 양쪽에서 import 하므로 prisma 등 서버 전용 모듈을 끌어오지 않는다)

import { SEPARATOR } from '@/lib/inv/search-tokens'

const SEPARATOR_GLOBAL = new RegExp(SEPARATOR.source, 'g')

/**
 * 구분자로 분해한 원시 토큰 — **중복을 제거하지 않는다.**
 * tokenizeProductName 은 중복을 제거하므로 §8.1 "키워드 반복" 탐지에 쓸 수 없다.
 */
export function splitTokens(raw: string): string[] {
  const out: string[] = []
  for (const part of String(raw ?? '').split(SEPARATOR)) {
    const token = part.trim()
    if (token) out.push(token)
  }
  return out
}

/** 소문자 + 연속 공백 1칸 축약 + trim. 사용자가 입력한 표기를 보존한 채 비교만 정규화한다. */
export function normalizeKeyword(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** 공백·구분자를 전부 제거한 소문자 형태 — §11 띄어쓰기 변형 탐지용. */
export function despaceKeyword(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(SEPARATOR_GLOBAL, '')
    .trim()
}

/**
 * 토큰을 정렬해 이어붙인 키 — §12 단어 순서만 바꾼 순열 중복 탐지용.
 * 중복 토큰은 제거하지 않는다(제거하면 "여성 여성 속옷"이 "여성 속옷"의 순열로 잡힌다).
 */
export function sortedTokenKey(raw: string): string {
  return splitTokens(raw)
    .map((t) => t.toLowerCase())
    .sort()
    .join(' ')
}

export type KeywordKeys = {
  normalized: string
  despaced: string
  sortedKey: string
}

export function keywordKeys(raw: string): KeywordKeys {
  return {
    normalized: normalizeKeyword(raw),
    despaced: despaceKeyword(raw),
    sortedKey: sortedTokenKey(raw),
  }
}
