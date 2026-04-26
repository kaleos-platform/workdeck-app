/**
 * 옵션 값 → 관리코드 자동 생성 유틸
 *
 * 우선순위:
 *   1. Space 커스텀 alias (spaceId + attributeName + value) — 서버에서 prefetch
 *   2. 시스템 공통 사전(KO_EN_DICT) — 이커머스 표준 축약 (BLACK→BLK 수준)
 *   3. 한글 사전 miss → 초성 로마자 → 3자 절삭
 *   4. 영문/숫자 입력 → 대문자 + 모음 제거 축약
 *   5. 혼합 → 알파벳·숫자만 추출 후 4번 규칙
 *
 * SKU 조립: `{product.code}-{c1}-{c2}-{c3}` — 코드 길이 내림차순 (긴 코드 앞)
 */

// ─── 시스템 공통 사전 (축약형 직접 저장) ───────────────────────────────────
export const KO_EN_DICT: Record<string, string> = {
  // 색상
  누드: 'NUD',
  블랙: 'BLK',
  화이트: 'WHT',
  베이지: 'BGE',
  네이비: 'NVY',
  그레이: 'GRY',
  그린: 'GRN',
  블루: 'BLU',
  레드: 'RED',
  핑크: 'PNK',
  옐로우: 'YLW',
  오렌지: 'ORG',
  퍼플: 'PPL',
  브라운: 'BRN',
  카키: 'KHK',
  민트: 'MNT',
  아이보리: 'IVY',
  와인: 'WIN',
  코랄: 'COR',
  머스타드: 'MUS',
  차콜: 'CHC',
  실버: 'SLV',
  골드: 'GLD',
  라벤더: 'LVD',
  // 사이즈
  대: 'LRG',
  중: 'MED',
  소: 'SML',
  특대: 'XLR',
  초대: 'XXL',
  // 재질
  면: 'CTN',
  린넨: 'LNN',
  울: 'WOL',
  실크: 'SLK',
  가죽: 'LTH',
  데님: 'DNM',
  폴리: 'POL',
  모달: 'MDL',
  // 기타
  기본: 'BSC',
  일반: 'NOR',
  프리미엄: 'PRM',
}

// ─── 초성 로마자 매핑 ──────────────────────────────────────────────────────
const CHOSUNG_ROMAN: Record<string, string> = {
  ㄱ: 'G',
  ㄴ: 'N',
  ㄷ: 'D',
  ㄹ: 'R',
  ㅁ: 'M',
  ㅂ: 'B',
  ㅅ: 'S',
  ㅇ: 'O',
  ㅈ: 'J',
  ㅊ: 'CH',
  ㅋ: 'K',
  ㅌ: 'T',
  ㅍ: 'P',
  ㅎ: 'H',
  ㄲ: 'GG',
  ㄸ: 'DD',
  ㅃ: 'BB',
  ㅆ: 'SS',
  ㅉ: 'JJ',
}

const CHOSUNG_LIST = [
  'ㄱ',
  'ㄲ',
  'ㄴ',
  'ㄷ',
  'ㄸ',
  'ㄹ',
  'ㅁ',
  'ㅂ',
  'ㅃ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅉ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
]

function extractChosung(ch: string): string {
  const code = ch.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return ''
  const chosungIdx = Math.floor(code / 588)
  return CHOSUNG_LIST[chosungIdx] ?? ''
}

/**
 * 영문·숫자 문자열을 3자 이하 축약 코드로 변환.
 * - 3자 이하면 그대로 (대문자)
 * - 3자 초과면 모음 제거 (BLACK → BLCK → 3자 → BLK)
 * - 전부 모음인 극단 케이스는 원본 앞 3자
 */
function abbreviateAlpha(upper: string): string {
  if (upper.length <= 3) return upper
  const noVowels = upper.replace(/[AEIOU]/g, '')
  if (noVowels.length === 0) return upper.slice(0, 3)
  if (noVowels.length <= 3) return noVowels
  return noVowels.slice(0, 3)
}

/**
 * 속성 값 → 옵션 코드 자동 생성 (Space alias 고려 X — 순수 규칙 기반).
 * Space alias는 호출부에서 먼저 조회하고 miss일 때 이 함수로 폴백.
 */
export function generateValueCode(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  // 순수 한글 (공백 허용)
  if (/^[가-힣\s]+$/.test(trimmed)) {
    const key = trimmed.replace(/\s/g, '')
    const dictHit = KO_EN_DICT[key]
    if (dictHit) return dictHit

    // 사전 miss → 초성 로마자
    let roman = ''
    for (const ch of key) {
      const cs = extractChosung(ch)
      if (cs) roman += CHOSUNG_ROMAN[cs] ?? ''
    }
    return roman.slice(0, 3)
  }

  // 알파벳·숫자만
  if (/^[A-Za-z0-9\s]+$/.test(trimmed)) {
    const upper = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '')
    return abbreviateAlpha(upper)
  }

  // 혼합 (한글+영문+숫자 등)
  const alnum = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (alnum) return abbreviateAlpha(alnum)
  return ''
}

/**
 * Space alias까지 반영한 최종 코드 결정.
 */
export function resolveValueCode(params: {
  attributeName: string
  value: string
  spaceAliasMap?: Map<string, string> | null
}): string {
  const key = aliasMapKey(params.attributeName, params.value)
  const spaceHit = params.spaceAliasMap?.get(key)
  if (spaceHit) return spaceHit
  return generateValueCode(params.value)
}

/**
 * Space alias Map의 표준 키 포맷 (컴포넌트·서버에서 공유).
 */
export function aliasMapKey(attributeName: string, value: string): string {
  return `${attributeName.trim()}::${value.trim()}`
}

// ─── SKU 조립 ──────────────────────────────────────────────────────────────

export type AttrCodeSpec = {
  attrIdx: number // 에디터에서의 원 순서 (동점 시 stable sort 근거)
  code: string
  maxLen: number // 해당 속성의 값 코드 중 최대 길이
}

/**
 * 옵션 조합 SKU 조립.
 * 속성들을 해당 속성의 "값 코드 중 최대 길이" 내림차순으로 정렬 (동점은 원 순서 유지).
 * productCode 있으면 맨 앞에 붙인다.
 */
export function generateOptionSku(params: {
  productCode: string | null | undefined
  attributeCodes: AttrCodeSpec[]
}): string {
  const sorted = [...params.attributeCodes].sort((a, b) => {
    if (b.maxLen !== a.maxLen) return b.maxLen - a.maxLen
    return a.attrIdx - b.attrIdx
  })
  const codes = sorted.map((x) => x.code).filter((c) => c.length > 0)
  const prodCode = params.productCode?.trim()
  const parts = prodCode ? [prodCode, ...codes] : codes
  return parts.join('-')
}

// ─── 데이터 호환 헬퍼 ──────────────────────────────────────────────────────

export type OptionAttributeValue = { value: string; code: string }
export type OptionAttribute = { name: string; values: OptionAttributeValue[] }

/**
 * 구 스키마 호환: values가 string[] 형태로 저장된 레거시 JSON을 {value, code}[]로 변환.
 * 기존 값은 자동으로 generateValueCode() 적용.
 */
export function normalizeOptionAttributes(raw: unknown): OptionAttribute[] {
  if (!Array.isArray(raw)) return []
  const result: OptionAttribute[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const name = String((item as { name?: unknown }).name ?? '').trim()
    if (!name) continue
    const valuesRaw = (item as { values?: unknown }).values
    if (!Array.isArray(valuesRaw)) continue
    const values: OptionAttributeValue[] = []
    for (const v of valuesRaw) {
      if (typeof v === 'string') {
        const trimmed = v.trim()
        if (!trimmed) continue
        values.push({ value: trimmed, code: generateValueCode(trimmed) })
      } else if (v && typeof v === 'object') {
        const vObj = v as { value?: unknown; code?: unknown }
        const value = String(vObj.value ?? '').trim()
        if (!value) continue
        const code = String(vObj.code ?? '').trim() || generateValueCode(value)
        values.push({ value, code })
      }
    }
    if (values.length > 0) result.push({ name, values })
  }
  return result
}
