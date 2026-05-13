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
  productName?: number | number[]
  productQuantity?: number | number[]
  memo?: number | number[]
}

/** 파싱된 주문 행 */
export type ParsedOrderRow = {
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

/**
 * Workbook을 읽는다. xlsx / xls / csv 외에 SpreadsheetML 2003 (XML이지만 .xls 확장자로
 * 배포되는 일부 채널 export 포맷)도 처리한다. SheetJS community 빌드의 xlml 파서는 셀 내
 * `<![CDATA[...]]>`를 처리하지 못하므로, 감지 시 CDATA 영역을 XML escape 후 텍스트로 전달한다.
 */
function readWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  if (isSpreadsheetMLXml(buffer)) {
    const text = decodeUtf8(buffer)
    const sanitized = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner: string) =>
      inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    )
    return XLSX.read(sanitized, { type: 'string', cellDates: true })
  }
  return XLSX.read(buffer, { type: 'array', cellDates: true })
}

/** SpreadsheetML 2003 헤더 감지 — 앞 256바이트 안에 XML 선언 + Workbook 네임스페이스가 있으면 매치 */
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
  const headerRow = jsonRows[0] ?? []
  const dataRowsRaw = jsonRows
    .slice(1)
    .filter((row) => Array.from(row).some((cell) => cell != null && String(cell).trim() !== ''))
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

  const dataRows = jsonRows
    .slice(1)
    .filter((row: unknown[]) => row.some((cell) => cell != null && String(cell).trim() !== ''))
  const rows: ParsedOrderRow[] = []
  const errors: { row: number; message: string }[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const rawRow = dataRows[i]
    const rowNum = i + 2 // Excel 행 번호 (1-based + header)

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
      errors.push({ row: rowNum, message: `필수 필드 누락: ${missing.join(', ')}` })
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
