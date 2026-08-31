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

/**
 * 검색어를 상품명 단어들로 남김없이 쪼갤 수 있는지 — §10 Rule 1 의 한국어 복합어 판정.
 *
 * 왜 필요한가: 한국어 검색어는 `노와이어브라` 처럼 공백 없이 붙여 쓰므로 splitTokens 로는
 * 토큰 1개다. "모든 토큰이 상품명 토큰인가"로는 절대 안 잡히고, 상품명 어순이 `브라 노와이어`
 * 라 despaced 부분문자열로도 안 잡힌다. 그래서 상품명 단어를 사전 삼아 단어 분해를 시도한다.
 *
 * greedy(최장일치)를 쓰면 안 된다 — 사전 {아, 아이, 이스} 에 입력 `아이스` 를 주면 `아이` 를
 * 먹고 `스` 에서 막혀 실패를 보고하지만 `아 + 이스` 가 존재한다. 상품명에는 접두사 관계
 * 토큰이 실제로 공존하므로(`브라` / `브라탑`) 위음성이 조용히 새어나간다. word-break DP 를 쓴다.
 *
 * 반환은 boolean 이 아니라 **분해 조각**이다 — 사용자에게 "노와이어 + 브라" 로 근거를 보여준다.
 * 여러 분해가 가능하면 조각 수가 가장 적은 것을 고른다(사람이 읽는 사유라 결정성이 필요하다).
 */
export type NameCoverage = { pieces: string[] }

/** DP 를 돌릴 최대 길이. KW_TOO_LONG(25자)은 검증을 멈추지 않으므로 장문이 들어올 수 있다. */
const COVER_MAX_LENGTH = 64

export function coverByNameTokens(keyword: string, nameTokens: string[]): NameCoverage | null {
  const target = despaceKeyword(keyword)
  // 길이 0 가드는 DP 진입 전에 둔다 — reach[0] = 0 이라 빈 입력이 "빈 사전으로 자명하게
  // 덮인다"로 해석될 수 있다. 상품명이 비어 있는 화면(키워드 마스터 등)에서 오발화한다.
  if (target.length === 0 || target.length > COVER_MAX_LENGTH) return null

  // 사전은 toLowerCase 가 아니라 despaceKeyword 로 만든다 — SEPARATOR 가 바뀌면 키워드 쪽과
  // 사전 쪽이 조용히 어긋난다(지금은 결과가 같아 테스트로 잡히지 않는 종류의 함정).
  // despaced → 첫 등장 원문 토큰. 사유 문구에 사용자가 입력한 표기를 그대로 돌려주기 위함.
  const dict = new Map<string, string>()
  for (const token of nameTokens) {
    const key = despaceKeyword(token)
    if (!key) continue
    if (!dict.has(key)) dict.set(key, token)
  }
  if (dict.size === 0) return null

  const n = target.length
  // reach[i] = 앞 i글자를 덮는 최소 조각 수. -1 = 도달 불가.
  const reach = new Array<number>(n + 1).fill(-1)
  const parent = new Array<number>(n + 1).fill(-1)
  reach[0] = 0

  for (let i = 1; i <= n; i += 1) {
    for (const key of dict.keys()) {
      const start = i - key.length
      if (start < 0 || reach[start] === -1) continue
      if (target.slice(start, i) !== key) continue
      const cost = reach[start] + 1
      if (reach[i] === -1 || cost < reach[i]) {
        reach[i] = cost
        parent[i] = start
      }
    }
  }

  if (reach[n] === -1) return null

  const pieces: string[] = []
  for (let i = n; i > 0; i = parent[i]) {
    pieces.push(dict.get(target.slice(parent[i], i)) ?? target.slice(parent[i], i))
  }
  pieces.reverse()
  return { pieces }
}

/**
 * 검색어에서 상품명 단어를 걷어낸 나머지 — §10 Rule 1 의 "이 부분만 빼면 쓸 수 있다" 제안.
 *
 * `50대여성브라` 는 상품명 단어(`여성`·`브라`)를 빼면 `50대` 가 남는다. 쿠팡은 상품명 단어를
 * 이미 색인하므로 붙여 넣어봐야 새 유입이 없고, 남은 조각이 진짜 새 진입로다.
 *
 * 토큰 단위로 먼저 처리한 뒤 토큰 **안쪽**의 부분문자열을 걷어낸다 — despaced 문자열에 바로
 * 손대면 `통기성 좋은 브라` 가 `통기성좋은` 으로 붙어버려 사용자가 쓰던 띄어쓰기를 잃는다.
 *
 * 상품명 단어를 하나도 못 찾으면 null(제안할 것이 없다). 긴 토큰부터 지우는 이유는 상품명에
 * `브라` 와 `브라탑` 이 함께 있을 때 짧은 쪽이 먼저 먹어 `탑` 이 남는 것을 막기 위해서다.
 */
export type NameStripResult = {
  /** 상품명 단어를 걷어낸 나머지. 전부 걷히면 빈 문자열 */
  stripped: string
  /** 걷어낸 상품명 단어들(원문 표기) */
  removed: string[]
}

export function stripNameTokens(keyword: string, nameTokens: string[]): NameStripResult | null {
  const raw = String(keyword ?? '').trim()
  if (!raw) return null

  // despaced → 원문 표기. 긴 것부터 지운다.
  const dict = new Map<string, string>()
  for (const token of nameTokens) {
    const key = despaceKeyword(token)
    if (key) if (!dict.has(key)) dict.set(key, token)
  }
  const keys = [...dict.keys()].sort((a, b) => b.length - a.length)
  if (keys.length === 0) return null

  const removed: string[] = []
  const keptTokens: string[] = []

  for (const token of splitTokens(raw)) {
    let rest = despaceKeyword(token)
    let touched = false
    for (const key of keys) {
      if (!rest.includes(key)) continue
      // 같은 단어가 두 번 들어간 검색어도 있으므로 전부 지운다.
      while (rest.includes(key)) {
        rest = rest.replace(key, '')
        removed.push(dict.get(key) as string)
      }
      touched = true
      if (!rest) break
    }
    if (!touched) {
      keptTokens.push(token)
      continue
    }
    if (rest) keptTokens.push(rest)
  }

  if (removed.length === 0) return null
  return { stripped: keptTokens.join(' ').trim(), removed: [...new Set(removed)] }
}
