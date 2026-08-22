// 재고 대조 파일 파서 — 쿠팡 health / 3PL 현재고조회 / 범용 포맷을 자동 감지한다.
import * as XLSX from 'xlsx'
import { syntheticExternalCode } from './reconciliation-external-code'

export type ParsedRow = {
  // 타입은 옵셔널이지만 모든 파서가 항상 채운다.
  // stock-status export는 파일에 코드 컬럼이 없으면 상품명+옵션명 기반 합성 코드를 쓴다
  // (수동 매칭을 저장할 키가 필요 — reconciliation-external-code.ts).
  externalCode?: string
  externalName?: string
  externalOptionName?: string
  externalBrandName?: string
  externalLocationName?: string
  quantity: number
}

export type ReconciliationFileFormat =
  | 'coupang_health'
  | 'threepl_current'
  | 'stock_status_export'
  | 'generic'
  | 'inventory_list'

export type ParseResult = {
  format: ReconciliationFileFormat
  rows: ParsedRow[]
  snapshotDate?: Date
}

// ─── 유틸리티 ──────────────────────────────────────────────

function parseInt_(val: unknown): number | null {
  if (val == null) return null
  const s = String(val).trim()
  if (s === '' || s === '-' || s === '데이터 없음') return null
  const cleaned = s.replace(/,/g, '')
  const n = Number(cleaned)
  if (isNaN(n)) return null
  return Math.round(n)
}

function parseStr(val: unknown): string | undefined {
  if (val == null) return undefined
  const s = String(val).trim()
  return s === '' || s === '-' ? undefined : s
}

/**
 * 2-row 헤더 병합 (inventory-parser.ts 와 동일한 패턴)
 */
function mergeHeaders(row0: unknown[], row1: unknown[]): string[] {
  const headers: string[] = []
  let lastParent = ''
  const len = Math.max(row0.length, row1.length)
  for (let i = 0; i < len; i++) {
    const parent = String(row0[i] ?? '')
      .trim()
      .replace(/\n/g, ' ')
    const child = String(row1[i] ?? '').trim()
    if (parent) lastParent = parent
    if (child && child !== lastParent) {
      headers.push(`${lastParent}_${child}`)
    } else {
      headers.push(parent || lastParent)
    }
  }
  return headers
}

// 파일명에서 YYYYMMDD / YYYY-MM-DD 형태 날짜 추출
function extractDateFromFileName(fileName: string): Date | undefined {
  const m1 = fileName.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/)
  if (m1) {
    const [, y, mo, d] = m1
    const date = new Date(`${y}-${mo}-${d}T00:00:00.000Z`)
    if (!Number.isNaN(date.getTime())) return date
  }
  return undefined
}

function rowToRecord(headers: string[], arr: unknown[]): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (let i = 0; i < headers.length; i++) {
    record[headers[i]] = arr[i]
  }
  return record
}

// ─── 포맷별 파서 ───────────────────────────────────────────

function parseCoupangHealth(rawData: unknown[][]): ParsedRow[] {
  const row0 = (rawData[0] as unknown[]) ?? []
  const row1 = (rawData[1] as unknown[]) ?? []
  const headers = mergeHeaders(row0, row1)
  const dataRows = rawData.slice(2)

  const rows: ParsedRow[] = []
  for (const raw of dataRows) {
    const rec = rowToRecord(headers, raw as unknown[])
    // 외부 코드: SKU ID 우선, 없으면 옵션 ID, 없으면 등록상품 ID
    const skuId = parseStr(rec['SKU ID'])
    const optionId = parseStr(rec['옵션 ID'] ?? rec['옵션ID'])
    const productId = parseStr(rec['등록상품 ID'] ?? rec['등록상품ID'])
    const externalCode = skuId ?? optionId ?? productId
    if (!externalCode) continue

    const qty = parseInt_(
      rec['판매가능재고 (실시간 기준)'] ?? rec['판매가능재고'] ?? rec['판매가능 재고']
    )
    if (qty == null) continue

    rows.push({
      externalCode,
      externalName: parseStr(rec['등록상품명']),
      externalOptionName: parseStr(rec['옵션명']),
      quantity: qty,
    })
  }
  return rows
}

function parseThreePlCurrent(rawData: unknown[][]): ParsedRow[] {
  const row0 = (rawData[0] as unknown[]) ?? []
  const headers = row0.map((v) => String(v ?? '').trim())
  const dataRows = rawData.slice(1)

  const rows: ParsedRow[] = []
  for (const raw of dataRows) {
    const rec = rowToRecord(headers, raw as unknown[])
    const externalCode = parseStr(rec['상품코드'] ?? rec['제품코드'])
    if (!externalCode) continue
    const qty = parseInt_(rec['가용재고'] ?? rec['재고'] ?? rec['수량'])
    if (qty == null) continue
    rows.push({
      externalCode,
      externalName: parseStr(rec['상품명']),
      externalOptionName: parseStr(rec['옵션'] ?? rec['옵션명']),
      quantity: qty,
    })
  }
  return rows
}

function parseStockStatusExport(rawData: unknown[][]): ParsedRow[] {
  const row0 = (rawData[0] as unknown[]) ?? []
  const headers = row0.map((v) => String(v ?? '').trim())
  const dataRows = rawData.slice(1)

  const rows: ParsedRow[] = []
  for (const raw of dataRows) {
    const rec = rowToRecord(headers, raw as unknown[])
    const realQty = parseInt_(rec['실재고'])
    // 실재고 빈값 → 사용자가 미입력 = 변동 없음으로 간주, 스킵
    if (realQty == null) continue
    const currentQty = parseInt_(rec['현재재고'])
    // 변동 없는 행 스킵
    if (currentQty != null && realQty === currentQty) continue

    const externalCode = parseStr(rec['externalCode'])
    const externalName = parseStr(rec['상품명'])
    const externalOptionName = parseStr(rec['옵션명'])
    const externalLocationName = parseStr(rec['위치명'])
    const externalBrandName = parseStr(rec['브랜드'])

    // 매칭 키는 externalCode 또는 상품명(→합성 코드) 둘 중 하나면 충분하다.
    // 위치명이 비어도 여기서 막지 않는다 — 보관 장소는 업로드 시 사용자가 고를 수 있고
    // (runReconciliationMatch 의 locationId 경로), 파서는 그 선택을 알 수 없다.
    if (!externalCode && !externalName) continue

    rows.push({
      // 위 가드를 통과했으므로 코드가 없으면 externalName 은 반드시 존재한다.
      externalCode: externalCode ?? syntheticExternalCode(externalName!, externalOptionName),
      externalName,
      externalOptionName,
      externalBrandName,
      externalLocationName,
      quantity: realQty,
    })
  }

  return rows
}

function parseGeneric(rawData: unknown[][]): ParsedRow[] {
  const row0 = (rawData[0] as unknown[]) ?? []
  const headers = row0.map((v) => String(v ?? '').trim())
  const dataRows = rawData.slice(1)

  const rows: ParsedRow[] = []
  for (const raw of dataRows) {
    const rec = rowToRecord(headers, raw as unknown[])
    const externalCode = parseStr(rec['제품코드'] ?? rec['상품코드'] ?? rec['코드'])
    if (!externalCode) continue
    const qty = parseInt_(rec['수량'] ?? rec['재고'] ?? rec['가용재고'])
    if (qty == null) continue
    rows.push({
      externalCode,
      externalName: parseStr(rec['상품명']),
      externalOptionName: parseStr(rec['옵션명'] ?? rec['옵션']),
      quantity: qty,
    })
  }
  return rows
}

// ─── 메인 파서 ─────────────────────────────────────────────

// 외부 WMS/채널 재고현황 '목록' export (SKU번호 기반)
// SKU번호 → externalCode 매칭. 실재고 = 가용재고 + 유보재고 + 하자재고 (안전재고=임계값 제외).
function parseInventoryList(rawData: unknown[][]): ParsedRow[] {
  const headers = ((rawData[0] as unknown[]) ?? []).map((v) => String(v ?? '').trim())
  const dataRows = rawData.slice(1)

  const rows: ParsedRow[] = []
  for (const raw of dataRows) {
    const rec = rowToRecord(headers, raw as unknown[])
    const externalCode = parseStr(rec['SKU번호'])
    if (!externalCode) continue
    // 물리 총재고 = 가용 + 유보 + 하자 (미기입=0)
    const qty =
      (parseInt_(rec['가용재고']) ?? 0) +
      (parseInt_(rec['유보재고']) ?? 0) +
      (parseInt_(rec['하자재고']) ?? 0)
    // 옵션 조합(옵션1 [+옵션2]) — externalCode 미매칭 시 상품명+옵션명 폴백 매칭용
    const opt1 = parseStr(rec['옵션1'])
    const opt2 = parseStr(rec['옵션2'])
    const optionName = [opt1, opt2].filter(Boolean).join(' ') || undefined
    rows.push({
      externalCode,
      externalName: parseStr(rec['상품명']),
      externalOptionName: optionName,
      quantity: qty,
    })
  }
  return rows
}

export function parseReconciliationFile(buffer: ArrayBuffer, fileName: string): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('엑셀에 시트가 없습니다')

  const ws = wb.Sheets[sheetName]
  const rawData = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
  })
  if (rawData.length < 2) throw new Error('데이터가 부족합니다')

  const row0 = (rawData[0] as unknown[]) ?? []
  const row1 = (rawData[1] as unknown[]) ?? []
  const headerStr0 = row0.map(String).join('|')
  const headerStr1 = row1.map(String).join('|')
  const combined = `${headerStr0}|${headerStr1}`

  const snapshotDate = extractDateFromFileName(fileName)

  // 1) 쿠팡 inventory_health
  if (
    (combined.includes('등록상품 ID') || combined.includes('등록상품ID')) &&
    (combined.includes('SKU ID') || combined.includes('옵션 ID')) &&
    combined.includes('판매가능재고')
  ) {
    const rows = parseCoupangHealth(rawData as unknown[][])
    if (rows.length === 0) {
      throw new Error('쿠팡 재고 health 파일에서 유효한 행을 찾지 못했습니다')
    }
    return { format: 'coupang_health', rows, snapshotDate }
  }

  // 2) 3PL 현재고 조회
  if (
    headerStr0.includes('상품코드') &&
    (headerStr0.includes('가용재고') || headerStr0.includes('재고')) &&
    headerStr0.includes('로케이션')
  ) {
    const rows = parseThreePlCurrent(rawData as unknown[][])
    if (rows.length === 0) {
      throw new Error('3PL 현재고 파일에서 유효한 행을 찾지 못했습니다')
    }
    return { format: 'threepl_current', rows, snapshotDate }
  }

  // 3) 재고 현황 내보내기: 실재고 + (externalCode 또는 위치명)
  if (
    headerStr0.includes('실재고') &&
    (headerStr0.includes('externalCode') || headerStr0.includes('위치명'))
  ) {
    const rows = parseStockStatusExport(rawData as unknown[][])
    if (rows.length === 0) {
      throw new Error(
        '재고 현황 내보내기 파일에서 변경된 행을 찾지 못했습니다. 실재고 값을 입력했는지 확인해 주세요.'
      )
    }
    return { format: 'stock_status_export', rows, snapshotDate }
  }

  // 4) 범용: "제품코드"/"상품코드" + "수량"
  if (
    (headerStr0.includes('제품코드') || headerStr0.includes('상품코드')) &&
    (headerStr0.includes('수량') || headerStr0.includes('재고'))
  ) {
    const rows = parseGeneric(rawData as unknown[][])
    if (rows.length === 0) {
      throw new Error('파일에서 유효한 행을 찾지 못했습니다')
    }
    return { format: 'generic', rows, snapshotDate }
  }

  // 5) 재고 현황 '목록' export(외부 WMS/채널): SKU번호 + 가용재고
  //    SKU번호 → externalCode 매칭, 실재고 = 가용+유보+하자
  if (headerStr0.includes('SKU번호') && headerStr0.includes('가용재고')) {
    const rows = parseInventoryList(rawData as unknown[][])
    if (rows.length === 0) {
      throw new Error('재고 현황 목록 파일에서 유효한 행(SKU번호)을 찾지 못했습니다')
    }
    return { format: 'inventory_list', rows, snapshotDate }
  }

  throw new Error(
    '지원하지 않는 파일 형식입니다. 쿠팡 재고 health, 3PL 현재고조회, 재고 현황 내보내기, 또는 (제품코드, 수량) 컬럼이 포함된 엑셀을 업로드해 주세요.'
  )
}
