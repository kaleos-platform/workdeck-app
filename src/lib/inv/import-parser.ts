// 재고 이동 대량 가져오기 — Excel/CSV 파서
// 고정된 한글 컬럼 스키마를 strict 검증하고 행 단위 파싱 오류를 수집한다.

import * as XLSX from 'xlsx'

export type ImportMovementType = 'INBOUND' | 'OUTBOUND' | 'RETURN' | 'TRANSFER' | 'ADJUSTMENT'

export type ParsedImportRow = {
  rowNumber: number // 1-indexed (헤더 포함 원본 파일 기준)
  movementDate: string
  type: ImportMovementType
  productName: string
  optionName: string
  quantity: number
  productCode?: string
  sku?: string
  locationName?: string
  toLocationName?: string
  channelName?: string
  orderDate?: string
  reason?: string
}

export type ImportParseError = { row: number; message: string }

export type ImportParseResult = {
  rows: ParsedImportRow[]
  parseErrors: ImportParseError[]
}

// 고정 컬럼 스키마
const REQUIRED_COLUMNS = ['날짜', '이동타입', '상품명', '옵션명', '수량'] as const
const OPTIONAL_COLUMNS = [
  '제품코드',
  'SKU',
  '위치',
  '도착위치',
  '판매채널',
  '주문일자',
  '사유',
] as const

// 한글 이동타입 → enum
const TYPE_MAP: Record<string, ImportMovementType> = {
  입고: 'INBOUND',
  출고: 'OUTBOUND',
  반품: 'RETURN',
  이동: 'TRANSFER',
  조정: 'ADJUSTMENT',
}

export class ImportColumnError extends Error {
  constructor(
    public readonly missingColumns: string[],
    public readonly foundColumns: string[],
  ) {
    super(`필수 컬럼이 누락되었습니다: ${missingColumns.join(', ')}`)
    this.name = 'ImportColumnError'
  }
}

function cell(row: Record<string, unknown>, key: string): string {
  const raw = row[key]
  if (raw === null || raw === undefined) return ''
  return String(raw).trim()
}

// YYYY-MM-DD 형식으로 정규화. 날짜 파싱이 가능하면 성공.
function parseDateString(raw: string): string | null {
  if (!raw) return null
  // Excel 날짜 숫자 직렬(예: 45678) 케이스 대응: SheetJS는 raw:false 시 문자열로 변환해주지만 안전장치
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseQuantity(raw: string): number | null {
  if (!raw) return null
  const n = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  if (!Number.isInteger(n)) return null
  if (n <= 0) return null
  return n
}

function sheetFromBuffer(buffer: ArrayBuffer, fileName: string) {
  const isCsv = /\.csv$/i.test(fileName)
  const wb = isCsv
    ? XLSX.read(buffer, { type: 'array', codepage: 65001 })
    : XLSX.read(buffer, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    throw new ImportColumnError(REQUIRED_COLUMNS.slice(), [])
  }
  return wb.Sheets[sheetName]
}

export function parseImportFile(buffer: ArrayBuffer, fileName: string): ImportParseResult {
  const sheet = sheetFromBuffer(buffer, fileName)
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: '',
  })

  if (raw.length === 0) {
    // 헤더도 없는 경우 → 필수 컬럼 전부 누락으로 간주
    throw new ImportColumnError(REQUIRED_COLUMNS.slice(), [])
  }

  const foundColumns = Object.keys(raw[0])
  const missing = REQUIRED_COLUMNS.filter((c) => !foundColumns.includes(c))
  if (missing.length > 0) {
    throw new ImportColumnError(missing, foundColumns)
  }

  const rows: ParsedImportRow[] = []
  const parseErrors: ImportParseError[] = []

  raw.forEach((r, idx) => {
    // 파일 기준 행 번호: 헤더가 1행 → 데이터 첫 행은 2
    const rowNumber = idx + 2

    const dateRaw = cell(r, '날짜')
    const typeRaw = cell(r, '이동타입')
    const productName = cell(r, '상품명')
    const optionName = cell(r, '옵션명')
    const quantityRaw = cell(r, '수량')

    // 빈 행은 건너뜀
    if (!dateRaw && !typeRaw && !productName && !optionName && !quantityRaw) {
      return
    }

    const movementDate = parseDateString(dateRaw)
    if (!movementDate) {
      parseErrors.push({ row: rowNumber, message: `날짜가 유효하지 않습니다: "${dateRaw}"` })
      return
    }

    const type = TYPE_MAP[typeRaw]
    if (!type) {
      parseErrors.push({
        row: rowNumber,
        message: `이동타입이 유효하지 않습니다: "${typeRaw}" (입고/출고/반품/이동/조정)`,
      })
      return
    }

    if (!productName) {
      parseErrors.push({ row: rowNumber, message: '상품명이 비어 있습니다' })
      return
    }
    if (!optionName) {
      parseErrors.push({ row: rowNumber, message: '옵션명이 비어 있습니다' })
      return
    }

    const quantity = parseQuantity(quantityRaw)
    if (quantity === null) {
      parseErrors.push({
        row: rowNumber,
        message: `수량은 양의 정수여야 합니다: "${quantityRaw}"`,
      })
      return
    }

    const productCode = cell(r, '제품코드') || undefined
    const sku = cell(r, 'SKU') || undefined
    const locationName = cell(r, '위치') || undefined
    const toLocationName = cell(r, '도착위치') || undefined
    const channelName = cell(r, '판매채널') || undefined
    const orderDateRaw = cell(r, '주문일자')
    const reason = cell(r, '사유') || undefined

    let orderDate: string | undefined
    if (orderDateRaw) {
      const parsed = parseDateString(orderDateRaw)
      if (!parsed) {
        parseErrors.push({
          row: rowNumber,
          message: `주문일자가 유효하지 않습니다: "${orderDateRaw}"`,
        })
        return
      }
      orderDate = parsed
    }

    rows.push({
      rowNumber,
      movementDate,
      type,
      productName,
      optionName,
      quantity,
      productCode,
      sku,
      locationName,
      toLocationName,
      channelName,
      orderDate,
      reason,
    })
  })

  return { rows, parseErrors }
}

export { REQUIRED_COLUMNS, OPTIONAL_COLUMNS }
