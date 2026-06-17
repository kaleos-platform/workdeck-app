/**
 * 채널 파일 업로드 파서
 * 범용 컬럼 매핑을 통해 어떤 채널의 파일이든 파싱할 수 있다.
 */
import * as XLSX from 'xlsx'

/**
 * Date 인스턴스를 로컬 타임존 기준 YYYY-MM-DD 문자열로 변환한다.
 * toISOString()은 UTC 기준이라 9시간 차이로 날짜가 밀릴 수 있으므로 사용하지 않는다.
 */
function formatDateLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 셀 값을 문자열로 정규화한다.
 * - Date 인스턴스 → formatDateLocal
 * - 그 외 → String()
 */
function cellToString(cell: unknown): string {
  if (cell instanceof Date) return formatDateLocal(cell)
  return cell != null ? String(cell) : ''
}

/** 파일 미리보기 결과 */
export type FilePreview = {
  headers: string[]
  sampleRows: string[][] // 최대 5행
  totalRows: number
  /** 전체 데이터 행에서 값이 하나도 없는 컬럼 인덱스 목록 */
  emptyColumns: number[]
  /** 파일에 포함된 모든 시트 이름 */
  sheetNames: string[]
  /** 현재 파싱 대상으로 사용된 시트 이름 */
  activeSheet: string
}

/** 고정 날짜 옵션 — 컬럼 매핑 대신 모든 행에 동일한 날짜를 사용 */
export type FixedDate = { fixed: string } // YYYY-MM-DD

/** 컬럼 매핑 정의 — 필드당 컬럼 인덱스 1개 또는 여러 개(여러 개면 파싱 시 공백으로 결합) */
export type ColumnMapping = {
  recipientName?: number | number[]
  phone?: number | number[]
  address?: number | number[]
  postalCode?: number | number[]
  deliveryMessage?: number | number[]
  orderDate?: number | number[] | FixedDate
  orderNumber?: number | number[]
  paymentAmount?: number | number[]
  /** true면 paymentAmount는 "주문 총액" → 동일 주문 그룹에서 행끼리 합산하지 않고 1회만 사용 */
  paymentIsOrderTotal?: boolean
  productName?: number | number[]
  productQuantity?: number | number[]
  memo?: number | number[]
}

/** 파싱된 주문 행 */
export type ParsedOrderRow = {
  sourceRowNumber: number
  recipientName: string
  phone: string
  address: string
  postalCode?: string
  deliveryMessage?: string
  orderDate: string
  orderNumber?: string
  paymentAmount?: number
  productName?: string
  productQuantity?: number
  memo?: string
}

/**
 * 한국 전화번호 정규화 — 숫자로 저장된 경우 앞자리 0 복원
 * 예: 1012345678 → 01012345678
 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits.length >= 9 && digits.length <= 11 && !digits.startsWith('0')) {
    return '0' + digits
  }
  return raw
}

/**
 * 한국 우편번호 정규화 — 5자리 미만이면 앞에 0 패딩
 * 예: 6234 → 06234
 */
function normalizePostalCode(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits.length > 0 && digits.length < 5) {
    return digits.padStart(5, '0')
  }
  return raw
}

/**
 * 여러 컬럼 인덱스에서 숫자를 추출해 합산한다.
 * 단일 인덱스면 해당 컬럼의 값만 파싱한다.
 * 유효한 숫자가 하나도 없으면 undefined 반환.
 */
function sumNumeric(idx: number | number[] | undefined, row: unknown[]): number | undefined {
  if (idx === undefined) return undefined
  const indices = Array.isArray(idx) ? idx : [idx]
  let total = 0
  let any = false
  for (const i of indices) {
    const raw = row[i] != null ? String(row[i]).replace(/[^0-9.-]/g, '') : ''
    const n = raw ? Number(raw) : NaN
    if (!isNaN(n)) {
      total += n
      any = true
    }
  }
  return any ? total : undefined
}

const HEADER_SCAN_LIMIT = 20
const MIN_HEADER_MATCH_COUNT = 3
const SHIPPING_HEADER_TOKENS = new Set([
  '상품주문번호',
  '주문번호',
  '배송속성',
  '풀필먼트사(주문 기준)',
  '택배사(주문 기준)',
  '배송방법(구매자 요청)',
  '배송방법',
  '택배사',
  '송장번호',
  '발송일',
  '판매채널',
  '구매자명',
  '구매자ID',
  '수취인명',
  '받는분',
  '수령인',
  '주문상태',
  '주문세부상태',
  '결제일',
  '상품번호',
  '상품명',
  '옵션정보',
  '수량',
  '상품가격',
  '결제금액',
  '판매자 상품코드',
  '수취인연락처1',
  '수취인연락처2',
  '전화',
  '전화번호',
  '연락처',
  '통합배송지',
  '기본배송지',
  '상세배송지',
  '받는분주소',
  '주소',
  '우편번호',
  '배송메세지',
  '배송메시지',
  '배송요청사항',
  '배송희망일',
  '주문일시',
])

type DataRowWithNumber = {
  row: unknown[]
  rowNumber: number
}

function nonEmptyCellCount(row: unknown[]): number {
  return Array.from(row).filter((cell) => cell != null && String(cell).trim() !== '').length
}

function isNonEmptyRow(row: unknown[]): boolean {
  return nonEmptyCellCount(row) > 0
}

function scoreHeaderRow(row: unknown[]): number {
  let score = 0
  for (const cell of row) {
    const value = cellToString(cell).trim()
    if (SHIPPING_HEADER_TOKENS.has(value)) score++
  }
  return score
}

function detectHeaderRowIndex(rows: unknown[][]): number {
  const scanCount = Math.min(rows.length, HEADER_SCAN_LIMIT)
  let bestIndex = 0
  let bestScore = 0

  for (let i = 0; i < scanCount; i++) {
    const score = scoreHeaderRow(rows[i] ?? [])
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  return bestScore >= MIN_HEADER_MATCH_COUNT ? bestIndex : 0
}

function getDataRows(rows: unknown[][], headerRowIndex: number): DataRowWithNumber[] {
  return rows
    .slice(headerRowIndex + 1)
    .map((row, i) => ({ row, rowNumber: headerRowIndex + i + 2 }))
    .filter(({ row }) => isNonEmptyRow(row))
}

/**
 * Workbook을 읽는다. xlsx / xls / csv 외에 SpreadsheetML 2003 (XML이지만 .xls 확장자로
 * 배포되는 일부 채널 export 포맷)도 처리한다. SheetJS community 빌드의 xlml 파서는 셀 내
 * `<![CDATA[...]]>`를 처리하지 못하므로, 감지 시 CDATA 영역을 XML escape 후 텍스트로 전달한다.
 */
function readWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  if (isSpreadsheetMLXml(buffer)) {
    const text = decodeUtf8(buffer)
    const sanitized = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner: string) =>
      escapeXmlText(inner)
    )
    return XLSX.read(sanitized, { type: 'string', cellDates: true })
  }
  // 바이너리 스프레드시트(XLSX zip / 레거시 XLS CFB)는 SheetJS가 자체 인코딩 처리하므로
  // 바이트 그대로 전달. CSV/텍스트만 인코딩 정규화(UTF-8 / EUC-KR 자동 판별) 후 전달한다.
  if (isBinarySpreadsheet(buffer)) {
    return XLSX.read(buffer, { type: 'array', cellDates: true })
  }
  return XLSX.read(decodeCsv(buffer), { type: 'string', cellDates: true })
}

/**
 * 바이너리 스프레드시트 매직넘버 감지.
 * - XLSX(zip): 50 4B 03 04 ("PK\x03\x04")
 * - 레거시 XLS(CFB/OLE2): D0 CF 11 E0 A1 B1 1A E1
 * 텍스트 디코더/UTF-8 probe가 바이너리에서 오작동하지 않도록 분기 가드.
 */
function isBinarySpreadsheet(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer.slice(0, 8))
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    return true // PK\x03\x04 (zip → xlsx)
  }
  const cfb = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  return b.length >= 8 && cfb.every((v, i) => b[i] === v)
}

/**
 * CSV/텍스트 버퍼를 인코딩 판별 후 문자열로 디코딩한다.
 * 한국 쇼핑몰 CSV는 UTF-8 또는 EUC-KR/CP949 가 혼재하므로 자동 판별한다.
 *  1. UTF-8 BOM(EF BB BF) → utf-8 (기본 디코더가 BOM 소비)
 *  2. UTF-16 BOM(FF FE / FE FF) → utf-16le / utf-16be
 *  3. utf-8 fatal 검증 통과 → utf-8 (BOM 없는 UTF-8, ASCII-only CP949 포함)
 *  4. 실패(throw) → euc-kr (Node WHATWG euc-kr = CP949 디코더)
 */
function decodeCsv(buffer: ArrayBuffer): string {
  const head = new Uint8Array(buffer.slice(0, 3))
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer)
  }
  if (head[0] === 0xff && head[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer)
  }
  if (head[0] === 0xfe && head[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('euc-kr').decode(buffer)
  }
}

/**
 * CDATA 내부 텍스트를 XML 텍스트 노드로 안전하게 escape한다.
 * 이미 escape된 entity(&amp; &lt; &gt; &quot; &apos; &#nnn; &#xhhh;)는 그대로 둔다 — 이중 escape 방지.
 */
function escapeXmlText(inner: string): string {
  return inner
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** SpreadsheetML 2003 헤더 감지 — 앞 512바이트(UTF-8 가정)에 XML 선언 + Workbook 네임스페이스가 있으면 매치 */
function isSpreadsheetMLXml(buffer: ArrayBuffer): boolean {
  const head = decodeUtf8(buffer.slice(0, 512))
  return head.startsWith('<?xml') && head.includes('schemas-microsoft-com:office:spreadsheet')
}

function decodeUtf8(buffer: ArrayBuffer): string {
  // BOM 자동 처리: TextDecoder의 utf-8 기본 동작이 BOM을 소비함
  return new TextDecoder('utf-8').decode(buffer)
}

/**
 * 파일에서 헤더와 샘플 데이터를 추출한다.
 * 시트 이름을 지정하면 해당 시트를 읽고, 지정하지 않으면 첫 번째 시트를 읽는다.
 * sheet_to_json 이 반환하는 희소(sparse) 배열을 정상 배열로 변환한다.
 */
export function previewFile(buffer: ArrayBuffer, sheetName?: string): FilePreview {
  const wb = readWorkbook(buffer)
  const sheetNames = wb.SheetNames
  const activeSheet = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0]
  const ws = wb.Sheets[activeSheet]
  const jsonRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })

  // 헤더 행과 모든 데이터 행 중 가장 긴 길이를 컬럼 수 기준으로 사용한다.
  const headerRowIndex = detectHeaderRowIndex(jsonRows)
  const headerRow = jsonRows[headerRowIndex] ?? []
  const dataRowsRaw = getDataRows(jsonRows, headerRowIndex).map(({ row }) => row)
  const maxColumns = Math.max(headerRow.length, ...dataRowsRaw.map((row) => row.length), 0)

  const headers = Array.from({ length: maxColumns }, (_, i) => String(headerRow[i] ?? '').trim())
  const sampleRows = dataRowsRaw
    .slice(0, 5)
    .map((row) => Array.from({ length: maxColumns }, (_, i) => cellToString(row[i])))

  const columnHasData: boolean[] = Array.from({ length: maxColumns }, () => false)
  for (const row of dataRowsRaw) {
    for (let i = 0; i < maxColumns; i++) {
      if (!columnHasData[i] && row[i] != null && String(row[i]).trim() !== '') {
        columnHasData[i] = true
      }
    }
  }
  const emptyColumns: number[] = []
  for (let i = 0; i < maxColumns; i++) {
    if (!columnHasData[i]) emptyColumns.push(i)
  }

  return {
    headers,
    sampleRows,
    totalRows: dataRowsRaw.length,
    emptyColumns,
    sheetNames,
    activeSheet,
  }
}

/**
 * 컬럼 매핑을 적용하여 파일을 파싱한다.
 */
export function parseWithMapping(
  buffer: ArrayBuffer,
  mapping: ColumnMapping
): { rows: ParsedOrderRow[]; errors: { row: number; message: string }[] } {
  const wb = readWorkbook(buffer)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const jsonRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })

  const headerRowIndex = detectHeaderRowIndex(jsonRows)
  const dataRows = getDataRows(jsonRows, headerRowIndex)
  const rows: ParsedOrderRow[] = []
  const errors: { row: number; message: string }[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const { row: rawRow, rowNumber } = dataRows[i]

    // Date 인스턴스를 YYYY-MM-DD 문자열로 정규화
    const row = rawRow.map((cell: unknown) => (cell instanceof Date ? formatDateLocal(cell) : cell))

    const get = (idx: number | number[] | undefined): string => {
      if (idx === undefined) return ''
      const indices = Array.isArray(idx) ? idx : [idx]
      return indices
        .map((i) => (row[i] != null ? String(row[i]).trim() : ''))
        .filter((v) => v !== '')
        .join(' ')
    }

    const recipientName = get(mapping.recipientName)
    const phone = normalizePhone(get(mapping.phone))
    const address = get(mapping.address)

    const missing: string[] = []
    if (!recipientName) missing.push('받는분')
    if (!phone) missing.push('전화')
    if (!address) missing.push('주소')
    if (missing.length > 0) {
      errors.push({ row: rowNumber, message: `필수 필드 누락: ${missing.join(', ')}` })
      continue
    }

    // 날짜 파싱:
    //  - FixedDate({ fixed: 'YYYY-MM-DD' }) 이면 고정 값 사용
    //  - 그 외에는 컬럼 매핑 경로. cellDates:true로 Date 인스턴스는 위에서 문자열 변환됨.
    //    텍스트 숫자 셀 폴백은 XLSX.SSF.parse_date_code로 정확히 변환.
    let orderDate: string
    const orderDateMapping = mapping.orderDate
    if (
      orderDateMapping !== null &&
      typeof orderDateMapping === 'object' &&
      !Array.isArray(orderDateMapping) &&
      'fixed' in orderDateMapping &&
      /^\d{4}-\d{2}-\d{2}$/.test(orderDateMapping.fixed)
    ) {
      orderDate = orderDateMapping.fixed
    } else {
      const orderDateRaw = get(orderDateMapping as number | number[] | undefined)
      if (!orderDateRaw) {
        orderDate = formatDateLocal(new Date())
      } else if (/^\d{4,6}$/.test(orderDateRaw)) {
        const serial = Number(orderDateRaw)
        const parsed = XLSX.SSF.parse_date_code(serial)
        orderDate = parsed
          ? `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
          : orderDateRaw
      } else {
        orderDate = orderDateRaw
      }
    }

    const rawPostalCode = get(mapping.postalCode)
    const postalCode = rawPostalCode ? normalizePostalCode(rawPostalCode) : undefined

    const paymentAmount = sumNumeric(mapping.paymentAmount, row)

    rows.push({
      sourceRowNumber: rowNumber,
      recipientName,
      phone,
      address,
      postalCode: postalCode || undefined,
      deliveryMessage: get(mapping.deliveryMessage) || undefined,
      orderDate,
      orderNumber: get(mapping.orderNumber) || undefined,
      paymentAmount,
      productName: get(mapping.productName) || undefined,
      productQuantity:
        mapping.productQuantity !== undefined
          ? Number(get(mapping.productQuantity)) || undefined
          : undefined,
      memo: get(mapping.memo) || undefined,
    })
  }

  return { rows, errors }
}
