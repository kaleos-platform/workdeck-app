/**
 * 재무 관리 Deck — 은행/카드 거래내역 파서.
 *
 * 소스(은행·카드사)마다 헤더 위치·컬럼 순서·날짜 포맷·입출금 표현이 다르므로,
 * 토큰 스코어 기반 헤더 자동 감지 + preamble(계좌번호/조회기간) 추출 + 컬럼 매핑 파싱을 제공한다.
 * 워크북 읽기·CP949 자동 판별 로직은 `src/lib/del/channel-import-parser.ts`와 동일 원리를
 * 재무 필드셋에 맞게 옮긴 것이다(배송 파서와 독립 유지).
 */
import { createHash } from 'crypto'
import * as XLSX from 'xlsx'

export type FinKind = 'BANK' | 'CARD'

/** 매핑 가능한 재무 필드 */
export type FinField =
  // 공통
  | 'txnDate'
  | 'description'
  | 'counterparty'
  // 은행
  | 'deposit'
  | 'withdrawal'
  | 'balanceAfter'
  | 'memo'
  // 카드
  | 'amount'
  | 'cancelFlag'
  | 'approvalNo'
  | 'settleDate'

export const BANK_FIELDS: { value: FinField; label: string; required?: boolean }[] = [
  { value: 'txnDate', label: '거래일시', required: true },
  { value: 'description', label: '적요/내용', required: true },
  { value: 'counterparty', label: '상대/의뢰인' },
  { value: 'deposit', label: '입금' },
  { value: 'withdrawal', label: '출금' },
  { value: 'balanceAfter', label: '거래후잔액' },
  { value: 'memo', label: '메모' },
]

export const CARD_FIELDS: { value: FinField; label: string; required?: boolean }[] = [
  { value: 'txnDate', label: '이용일자', required: true },
  { value: 'description', label: '가맹점명', required: true },
  { value: 'amount', label: '매출금액', required: true },
  { value: 'cancelFlag', label: '취소구분' },
  { value: 'approvalNo', label: '승인번호' },
  { value: 'settleDate', label: '결제일자' },
]

/** 헤더 자동 감지 토큰 — 은행/카드 공통 (한 행에 3개 이상 매칭 시 헤더로 판정) */
const FINANCE_HEADER_TOKENS = new Set([
  // 은행
  '거래일시',
  '거래일자',
  '거래일',
  '일시',
  '적요',
  '내용',
  '거래내용',
  '추가메모',
  '의뢰인/수취인',
  '입금',
  '입금액',
  '맡기신금액',
  '출금',
  '출금액',
  '찾으신금액',
  '지급',
  '지급(원)',
  '입금(원)',
  '거래후잔액',
  '거래후 잔액',
  '잔액',
  '거래후 잔액(원)',
  '거래구분',
  '메모',
  '거래점',
  '거래점명',
  '취급점',
  // 카드
  '이용일자',
  '이용일',
  '매입일자',
  '카드번호',
  '구분',
  '매출구분',
  '승인번호',
  '가맹점명',
  '가맹점',
  '가맹점번호',
  '매출금액',
  '이용금액',
  '승인금액',
  '취소구분',
  '결제일자',
  '부가세',
])

/** 헤더 토큰 정규화 — 셀 내 줄바꿈(하나카드 멀티라인 헤더) 제거 */
function normalizeHeaderCell(value: unknown): string {
  return cellToString(value).replace(/\s+/g, '').trim()
}

function cellToString(cell: unknown): string {
  if (cell instanceof Date) {
    const date = formatDateLocal(cell)
    const hh = cell.getHours()
    const mm = cell.getMinutes()
    const ss = cell.getSeconds()
    // 시간이 자정이면 날짜만(카드 등 날짜-only), 아니면 시간 보존(은행 거래일시 identity 안정화)
    if (hh === 0 && mm === 0 && ss === 0) return date
    return `${date} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }
  return cell != null ? String(cell) : ''
}

function formatDateLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ─── 워크북 읽기 (xlsx / xls / csv, CP949 자동 판별) ──────────────────────────

function readWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  // cellDates:true — 'YYYY-MM-DD HH:MM:SS' 거래일시의 실제 시간을 보존(identity 안정화).
  // 부작용: 'YYYY-MM-DD' 날짜-only(하이픈)는 UTC 자정→KST 09:00 으로 표기될 수 있으나,
  // 이는 contentHash 보조필드(결제일자)에만 영향 — 거래일시는 시간이 있어 무관. 카드 식별은
  // normalizeDateOnly(시간 제거)로 산출하므로 안전.
  if (isBinarySpreadsheet(buffer)) {
    return XLSX.read(buffer, { type: 'array', cellDates: true })
  }
  return XLSX.read(decodeCsv(buffer), { type: 'string', cellDates: true })
}

function isBinarySpreadsheet(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer.slice(0, 8))
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    return true // PK\x03\x04 (zip → xlsx)
  }
  const cfb = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  return b.length >= 8 && cfb.every((v, i) => b[i] === v)
}

/** UTF-8 / CP949(EUC-KR) 자동 판별. 한국 은행 export는 두 인코딩이 혼재한다. */
function decodeCsv(buffer: ArrayBuffer): string {
  const head = new Uint8Array(buffer.slice(0, 3))
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer)
  }
  if (head[0] === 0xff && head[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer)
  if (head[0] === 0xfe && head[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('euc-kr').decode(buffer)
  }
}

function sheetRows(
  wb: XLSX.WorkBook,
  sheetName?: string
): { rows: unknown[][]; activeSheet: string } {
  const names = wb.SheetNames
  const activeSheet = sheetName && names.includes(sheetName) ? sheetName : names[0]
  const ws = wb.Sheets[activeSheet]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })
  return { rows, activeSheet }
}

// ─── 헤더 감지 ────────────────────────────────────────────────────────────────

const HEADER_SCAN_LIMIT = 25
const MIN_HEADER_MATCH = 3

function scoreHeaderRow(row: unknown[]): number {
  let score = 0
  for (const cell of row) {
    if (FINANCE_HEADER_TOKENS.has(normalizeHeaderCell(cell))) score++
  }
  return score
}

function detectHeaderRowIndex(rows: unknown[][]): number {
  const scan = Math.min(rows.length, HEADER_SCAN_LIMIT)
  let bestIndex = 0
  let bestScore = 0
  for (let i = 0; i < scan; i++) {
    const score = scoreHeaderRow(rows[i] ?? [])
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }
  return bestScore >= MIN_HEADER_MATCH ? bestIndex : 0
}

function isNonEmptyRow(row: unknown[]): boolean {
  return row.some((c) => c != null && String(c).trim() !== '')
}

// ─── preamble 추출 (헤더행 이전: 계좌번호 / 조회기간 / 예금주) ─────────────────

export type FinPreamble = {
  accountNumber?: string
  holder?: string
  periodFrom?: string
  periodTo?: string
}

function extractPreamble(rows: unknown[][], headerRowIndex: number): FinPreamble {
  const out: FinPreamble = {}
  const text = rows
    .slice(0, headerRowIndex)
    .map((r) => r.map((c) => cellToString(c)).join(' '))
    .join('\n')

  const acct = text.match(/(?:계좌번호|카드번호)\s*[:：]?\s*([0-9*\-]{6,})/)
  if (acct) out.accountNumber = acct[1].trim()

  const holder = text.match(/예금주(?:명)?\s*[:：]?\s*([^\s,]+(?:\s[^\s,]+)?)/)
  if (holder) out.holder = holder[1].trim()

  // 조회기간: "2025-01-01 ~ 2025-12-31" / "2026.05.01~2026.05.31" (틸드형)
  const tilde = text.match(/(\d{4}[.\-]\d{2}[.\-]\d{2})\s*[~∼]\s*(\d{4}[.\-]\d{2}[.\-]\d{2})/)
  if (tilde) {
    out.periodFrom = normalizeDateOnly(tilde[1])
    out.periodTo = normalizeDateOnly(tilde[2])
  } else {
    // "조회시작일자:2025-01-01 ... 조회종료일자:2025-12-31" (라벨형, 기업은행)
    const start = text.match(/시작일자?\s*[:：]?\s*(\d{4}[.\-]\d{2}[.\-]\d{2})/)
    const end = text.match(/종료일자?\s*[:：]?\s*(\d{4}[.\-]\d{2}[.\-]\d{2})/)
    if (start) out.periodFrom = normalizeDateOnly(start[1])
    if (end) out.periodTo = normalizeDateOnly(end[1])
  }
  return out
}

// ─── 미리보기 ─────────────────────────────────────────────────────────────────

export type FinPreview = {
  headers: string[]
  sampleRows: string[][]
  totalRows: number
  emptyColumns: number[]
  sheetNames: string[]
  activeSheet: string
  preamble: FinPreamble
}

export function previewFinanceFile(buffer: ArrayBuffer, sheetName?: string): FinPreview {
  const wb = readWorkbook(buffer)
  const { rows, activeSheet } = sheetRows(wb, sheetName)
  const headerRowIndex = detectHeaderRowIndex(rows)
  const headerRow = rows[headerRowIndex] ?? []
  const dataRows = rows.slice(headerRowIndex + 1).filter(isNonEmptyRow)
  const maxCols = Math.max(headerRow.length, ...dataRows.map((r) => r.length), 0)

  const headers = Array.from({ length: maxCols }, (_, i) => cellToString(headerRow[i]).trim())
  const sampleRows = dataRows
    .slice(0, 5)
    .map((r) => Array.from({ length: maxCols }, (_, i) => cellToString(r[i]).trim()))

  const colHasData = Array.from({ length: maxCols }, () => false)
  for (const r of dataRows) {
    for (let i = 0; i < maxCols; i++) {
      if (!colHasData[i] && r[i] != null && String(r[i]).trim() !== '') colHasData[i] = true
    }
  }
  const emptyColumns = colHasData.map((has, i) => (has ? -1 : i)).filter((i) => i >= 0)

  return {
    headers,
    sampleRows,
    totalRows: dataRows.length,
    emptyColumns,
    sheetNames: wb.SheetNames,
    activeSheet,
    preamble: extractPreamble(rows, headerRowIndex),
  }
}

// ─── 값 정규화 ────────────────────────────────────────────────────────────────

/** "687,184" → 687184, 빈값/문자 → 0 */
export function parseAmount(raw: unknown): number {
  if (raw == null) return 0
  const s = String(raw).replace(/[^0-9.\-]/g, '')
  if (!s || s === '-' || s === '.') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** 다양한 날짜 포맷을 YYYY-MM-DD 로 정규화 (시간 제거). */
export function normalizeDateOnly(raw: unknown): string {
  if (raw instanceof Date) return formatDateLocal(raw)
  const s = String(raw ?? '').trim()
  if (!s) return ''
  // 'YYYY-MM-DD' / 'YYYY.MM.DD' / 'YYYY/MM/DD' (+ 시간 무시)
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  // Excel serial
  if (/^\d{4,6}$/.test(s)) {
    const p = XLSX.SSF.parse_date_code(Number(s))
    if (p) return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
  }
  return s
}

/** 날짜+시간을 YYYY-MM-DD HH:MM:SS (시간 없으면 날짜만) 로 정규화 — identity 키 안정화용. */
export function normalizeDateTime(raw: unknown): string {
  if (raw instanceof Date) {
    const date = formatDateLocal(raw)
    const hh = String(raw.getHours()).padStart(2, '0')
    const mm = String(raw.getMinutes()).padStart(2, '0')
    const ss = String(raw.getSeconds()).padStart(2, '0')
    return hh === '00' && mm === '00' && ss === '00' ? date : `${date} ${hh}:${mm}:${ss}`
  }
  const s = String(raw ?? '').trim()
  const date = normalizeDateOnly(s)
  const time = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (date && time) {
    return `${date} ${time[1].padStart(2, '0')}:${time[2]}:${(time[3] ?? '00').padStart(2, '0')}`
  }
  return date
}

// ─── 매핑 파싱 ────────────────────────────────────────────────────────────────

export type FinColumnMapping = Partial<Record<FinField, number | number[]>>

export type ParsedFinRow = {
  sourceRowNumber: number
  txnDate: string // YYYY-MM-DD HH:MM:SS | YYYY-MM-DD
  direction: 'IN' | 'OUT'
  amount: number
  balanceAfter?: number
  description?: string
  counterparty?: string
  approvalNo?: string
  cancelFlag?: string
  identityKey: string
  contentHash: string
}

export type ParseResult = {
  rows: ParsedFinRow[]
  errors: { row: number; message: string }[]
}

function getCell(idx: number | number[] | undefined, row: unknown[], sep = ' '): string {
  if (idx === undefined) return ''
  const indices = Array.isArray(idx) ? idx : [idx]
  return indices
    .map((i) => cellToString(row[i]).trim())
    .filter((v) => v !== '')
    .join(sep)
}

function sha(parts: (string | number)[]): string {
  return createHash('sha256').update(parts.join('')).digest('hex').slice(0, 32)
}

/**
 * 컬럼 매핑으로 파일을 파싱한다.
 * accountId 는 identity 키 산출에 필요(은행 거래는 자연 고유키가 없어 계좌+일시+금액+잔액으로 식별).
 */
export function parseFinanceWithMapping(
  buffer: ArrayBuffer,
  mapping: FinColumnMapping,
  kind: FinKind,
  accountId: string,
  sheetName?: string
): ParseResult {
  const wb = readWorkbook(buffer)
  const { rows } = sheetRows(wb, sheetName)
  const headerRowIndex = detectHeaderRowIndex(rows)
  const dataRows = rows
    .slice(headerRowIndex + 1)
    .map((row, i) => ({ row, rowNumber: headerRowIndex + i + 2 }))
    .filter(({ row }) => isNonEmptyRow(row))

  const out: ParsedFinRow[] = []
  const errors: { row: number; message: string }[] = []

  for (const { row, rowNumber } of dataRows) {
    const txnDate = normalizeDateTime(getCell(mapping.txnDate, row))
    if (!txnDate) {
      errors.push({ row: rowNumber, message: '거래일시 누락' })
      continue
    }
    const description = getCell(mapping.description, row, ' / ') || undefined
    const counterparty = getCell(mapping.counterparty, row) || undefined

    let direction: 'IN' | 'OUT'
    let amount: number
    let balanceAfter: number | undefined
    let approvalNo: string | undefined
    let cancelFlag: string | undefined

    if (kind === 'BANK') {
      const deposit = parseAmount(getCell(mapping.deposit, row))
      const withdrawal = parseAmount(getCell(mapping.withdrawal, row))
      if (deposit > 0) {
        direction = 'IN'
        amount = deposit
      } else if (withdrawal > 0) {
        direction = 'OUT'
        amount = withdrawal
      } else {
        // 0/0 정보성 행(예: 이자 결산) — 금액 0, 지출로 표기(현금흐름 무영향)
        direction = 'OUT'
        amount = 0
      }
      const balRaw = getCell(mapping.balanceAfter, row)
      balanceAfter = balRaw ? parseAmount(balRaw) : undefined
    } else {
      // CARD — 매출금액은 지출. 취소구분 캡처(집계에서 부호 반전 처리).
      amount = parseAmount(getCell(mapping.amount, row))
      direction = 'OUT'
      approvalNo = getCell(mapping.approvalNo, row) || undefined
      cancelFlag = getCell(mapping.cancelFlag, row) || undefined
    }

    // identity 키(안정) ↔ content 해시(가변) 분리
    let identityKey: string
    let contentHash: string
    if (kind === 'BANK') {
      // 은행 거래는 확정 후 불변 — 일시+방향+금액+잔액으로 식별(잔액이 강한 식별자).
      // ⚠️ 거래후잔액 컬럼이 없는 export면 동일 일시·금액·방향 거래 2건이 같은 identity로
      //    충돌해 둘째가 중복 제거된다. 안전한 은행 dedup은 거래후잔액 컬럼을 전제로 한다.
      identityKey = sha([accountId, txnDate, direction, amount, balanceAfter ?? ''])
      contentHash = sha([description ?? '', counterparty ?? ''])
    } else {
      // 카드: 승인번호가 강한 식별자. 가승인→매입확정 시 매입일/금액 변동 가능 →
      // 승인번호+이용일+취소구분으로 식별(승인번호 있을 때).
      const settle = getCell(mapping.settleDate, row)
      if (approvalNo) {
        identityKey = sha([accountId, approvalNo, normalizeDateOnly(txnDate), cancelFlag ?? ''])
      } else {
        // 승인번호 없는 export: 이용일+취소구분만으론 같은 날 거래가 전부 충돌(둘째가 DUP_SAME로 손실).
        // 금액·가맹점·상대를 식별에 포함해 충돌을 줄인다. 동일 파일 재임포트엔 값이 동일 → 안정(DUP_SAME 유지).
        identityKey = sha([
          accountId,
          normalizeDateOnly(txnDate),
          cancelFlag ?? '',
          amount,
          description ?? '',
          counterparty ?? '',
        ])
      }
      contentHash = sha([amount, settle, description ?? ''])
    }

    out.push({
      sourceRowNumber: rowNumber,
      txnDate,
      direction,
      amount,
      balanceAfter,
      description,
      counterparty,
      approvalNo,
      cancelFlag,
      identityKey,
      contentHash,
    })
  }

  return { rows: out, errors }
}
