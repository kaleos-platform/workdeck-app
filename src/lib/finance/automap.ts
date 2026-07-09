/**
 * 재무 관리 Deck — 업로드 파일의 출처/종류 자동 인식 + 헤더→필드 자동 매핑 + 프리셋 매칭.
 *
 * 단일 화면 업로드(데이터 등록)에서 사용자가 매핑을 거의 손대지 않도록:
 *   - detectKind: 헤더 토큰으로 은행/카드 판별
 *   - guessInstitution: 파일명으로 기관명 추정(보조 — 사용자가 계좌 선택으로 확정)
 *   - autoMapFinHeaders: 헤더명→필드 자동 매핑(HINT_MAP, 우선순위 매칭)
 *   - findBestPreset: 저장된 매핑 프리셋 중 헤더 서명이 가장 일치하는 것
 *   - resolveMapping: {headerName,field} 쌍 → 현재 파일 헤더 인덱스(컬럼 재배열 견고)
 */
import type { FinField, FinKind, FinColumnMapping } from '@/lib/finance/parser'

/** 헤더 정규화 — 공백/괄호 제거 + 소문자(라틴 대비). */
function norm(h: string): string {
  return h.replace(/\s+/g, '').toLowerCase()
}

/** 매핑 와이어 포맷 — 프리셋·미리보기 공통(컬럼 순서 변동에 견고). */
export type MappingPair = { headerName: string; field: FinField }

// ─── 종류 판별 ────────────────────────────────────────────────────────────────

const CARD_SIGNAL = ['승인번호', '가맹점', '이용일자', '매출금액', '취소구분', '매입일자']

/** 헤더에 카드 시그널 토큰이 있으면 CARD, 아니면 BANK. */
export function detectKind(headers: string[]): FinKind {
  const joined = headers.map(norm).join('|')
  const hits = CARD_SIGNAL.filter((t) => joined.includes(norm(t))).length
  return hits >= 2 ? 'CARD' : 'BANK'
}

// ─── 기관명 추정(파일명 기반 보조) ──────────────────────────────────────────────

const INSTITUTION_HINTS: { hint: string; name: string }[] = [
  { hint: '기업', name: '기업은행' },
  { hint: 'ibk', name: '기업은행' },
  { hint: '하나카드', name: '하나카드' },
  { hint: '하나', name: '하나은행' },
  { hint: '우리', name: '우리은행' },
  { hint: '신한', name: '신한은행' },
  { hint: '국민', name: '국민은행' },
  { hint: 'kb', name: '국민은행' },
  { hint: '농협', name: '농협은행' },
  { hint: '카카오', name: '카카오뱅크' },
  { hint: '토스', name: '토스뱅크' },
  { hint: '삼성카드', name: '삼성카드' },
  { hint: '현대카드', name: '현대카드' },
  { hint: '롯데카드', name: '롯데카드' },
  { hint: '신한카드', name: '신한카드' },
  { hint: 'kb카드', name: '국민카드' },
]

/** 파일명에서 기관명 추정(없으면 undefined). 카드 힌트를 은행보다 먼저 검사. */
export function guessInstitution(fileName: string): string | undefined {
  const f = norm(fileName)
  for (const { hint, name } of INSTITUTION_HINTS) {
    if (f.includes(norm(hint))) return name
  }
  return undefined
}

// ─── 계좌/카드번호 매칭 ─────────────────────────────────────────────────────────

/**
 * 파일에서 추출한 계좌/카드번호와 등록된 번호를 비교한다.
 * 카드 export는 마스킹(5107-****-****-1234)이 일반적이라 '*'를 와일드카드로 취급:
 *   - 둘 다 숫자만이면 완전일치
 *   - 마스킹 포함이면 자리수 동일 + 위치별 비교('*'는 어느 쪽이든 통과)
 */
export function matchesAccountNumber(a: string, b: string): boolean {
  const na = a.replace(/[^0-9*]/g, '')
  const nb = b.replace(/[^0-9*]/g, '')
  if (na.length < 4 || nb.length < 4) return false
  const masked = na.includes('*') || nb.includes('*')
  if (!masked) return na === nb
  if (na.length !== nb.length) return false
  for (let i = 0; i < na.length; i++) {
    if (na[i] !== '*' && nb[i] !== '*' && na[i] !== nb[i]) return false
  }
  return true
}

/**
 * 카드 export는 카드번호가 preamble이 아닌 행 컬럼인 경우가 많다.
 * "카드번호" 헤더 컬럼을 찾아 샘플 행의 첫 비어있지 않은 값을 돌려준다(없으면 undefined).
 */
export function extractCardNumberColumn(
  headers: string[],
  sampleRows: string[][]
): string | undefined {
  const idx = headers.findIndex((h) => norm(h).includes('카드번호'))
  if (idx < 0) return undefined
  for (const row of sampleRows) {
    const v = (row[idx] ?? '').trim()
    if (v) return v
  }
  return undefined
}

// ─── 헤더 → 필드 자동 매핑 ──────────────────────────────────────────────────────

/** 필드별 헤더 힌트(부분 포함). 우선순위 = 배열 순서(구체적인 것 먼저). */
const BANK_HINTS: { field: FinField; hints: string[] }[] = [
  { field: 'txnDate', hints: ['거래일시', '거래일자', '거래일', '일시', '거래기록일', '날짜'] },
  { field: 'balanceAfter', hints: ['거래후잔액', '거래후 잔액', '잔액'] },
  { field: 'deposit', hints: ['입금액', '맡기신금액', '맡기신', '입금(원)', '입금'] },
  { field: 'withdrawal', hints: ['출금액', '찾으신금액', '찾으신', '지급(원)', '지급', '출금'] },
  { field: 'counterparty', hints: ['의뢰인', '수취인', '보내는', '받는', '상대', '거래상대'] },
  { field: 'description', hints: ['적요', '거래내용', '내용', '거래구분', '기재내용'] },
  { field: 'memo', hints: ['추가메모', '메모', '비고'] },
]

const CARD_HINTS: { field: FinField; hints: string[] }[] = [
  { field: 'settleDate', hints: ['결제일자', '매입일자', '결제일', '청구일'] },
  { field: 'txnDate', hints: ['이용일자', '이용일', '매출일자', '승인일자', '거래일자'] },
  { field: 'approvalNo', hints: ['승인번호'] },
  { field: 'cancelFlag', hints: ['취소구분', '매출구분', '구분'] },
  { field: 'amount', hints: ['매출금액', '이용금액', '승인금액', '청구금액', '금액'] },
  { field: 'description', hints: ['가맹점명', '가맹점', '이용가맹점', '가맹점정보'] },
]

/**
 * 헤더명 배열 → {headerName, field} 매핑 쌍을 자동 생성한다.
 * 각 필드는 우선순위 순으로, 아직 사용되지 않은 헤더 중 힌트가 포함된 첫 헤더에 바인딩.
 */
export function autoMapFinHeaders(headers: string[], kind: FinKind): MappingPair[] {
  const table = kind === 'CARD' ? CARD_HINTS : BANK_HINTS
  const used = new Set<number>()
  const pairs: MappingPair[] = []
  const normed = headers.map(norm)

  for (const { field, hints } of table) {
    let foundIdx = -1
    for (const hint of hints) {
      const nh = norm(hint)
      const idx = normed.findIndex((h, i) => !used.has(i) && h !== '' && h.includes(nh))
      if (idx >= 0) {
        foundIdx = idx
        break
      }
    }
    if (foundIdx >= 0) {
      used.add(foundIdx)
      pairs.push({ headerName: headers[foundIdx], field })
    }
  }
  return pairs
}

// ─── 프리셋 매칭 ────────────────────────────────────────────────────────────────

export type PresetLike = {
  id: string
  name: string
  institution: string
  kind: FinKind
  mapping: unknown
  defaultAccountId?: string | null
}

function pairsFromMapping(mapping: unknown): MappingPair[] {
  if (!Array.isArray(mapping)) return []
  return mapping.filter(
    (m): m is MappingPair =>
      !!m &&
      typeof m === 'object' &&
      typeof m.headerName === 'string' &&
      typeof m.field === 'string'
  )
}

/**
 * 저장된 프리셋 중 현재 파일 헤더와 가장 잘 맞는 것을 고른다.
 * 점수 = 프리셋 headerName 중 현재 헤더에 존재하는 비율. 0.6 미만이면 매칭 없음.
 */
export function findBestPreset(presets: PresetLike[], headers: string[]): PresetLike | null {
  const have = new Set(headers.map(norm))
  let best: PresetLike | null = null
  let bestScore = 0
  for (const p of presets) {
    const pairs = pairsFromMapping(p.mapping)
    if (pairs.length === 0) continue
    const matched = pairs.filter((pr) => have.has(norm(pr.headerName))).length
    const score = matched / pairs.length
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  return bestScore >= 0.6 ? best : null
}

/**
 * {headerName, field} 쌍을 현재 파일 헤더 인덱스 기반 FinColumnMapping 으로 변환한다.
 * 동일 필드에 다중 헤더가 매핑되면 인덱스 배열(파서가 공백 결합)로 묶는다.
 */
export function resolveMapping(headers: string[], pairs: MappingPair[]): FinColumnMapping {
  const normed = headers.map(norm)
  const mapping: FinColumnMapping = {}
  for (const { headerName, field } of pairs) {
    const idx = normed.indexOf(norm(headerName))
    if (idx < 0) continue
    const existing = mapping[field]
    if (existing === undefined) {
      mapping[field] = idx
    } else if (Array.isArray(existing)) {
      existing.push(idx)
    } else {
      mapping[field] = [existing, idx]
    }
  }
  return mapping
}
