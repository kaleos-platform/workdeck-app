/**
 * 채널 파일 업로드 파서
 * 범용 컬럼 매핑을 통해 어떤 채널의 파일이든 파싱할 수 있다.
 */
import * as XLSX from 'xlsx'

/** 파일 미리보기 결과 */
export type FilePreview = {
  headers: string[]
  sampleRows: string[][] // 최대 5행
  totalRows: number
}

/** 컬럼 매핑 정의 */
export type ColumnMapping = {
  recipientName?: number // 컬럼 인덱스
  phone?: number
  address?: number
  postalCode?: number
  deliveryMessage?: number
  orderDate?: number
  orderNumber?: number
  paymentAmount?: number
  productName?: number
  productQuantity?: number
  memo?: number
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
 * 파일에서 헤더와 샘플 데이터를 추출한다.
 */
export function previewFile(buffer: ArrayBuffer): FilePreview {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const jsonRows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })

  const headers = (jsonRows[0] ?? []).map((v) => String(v ?? ''))
  const dataRows = jsonRows.slice(1).filter((row) =>
    row.some((cell) => cell != null && String(cell).trim() !== '')
  )
  const sampleRows = dataRows.slice(0, 5).map((row) =>
    row.map((v) => String(v ?? ''))
  )

  return {
    headers,
    sampleRows,
    totalRows: dataRows.length,
  }
}

/**
 * 컬럼 매핑을 적용하여 파일을 파싱한다.
 */
export function parseWithMapping(
  buffer: ArrayBuffer,
  mapping: ColumnMapping
): { rows: ParsedOrderRow[]; errors: { row: number; message: string }[] } {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const jsonRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })

  const dataRows = jsonRows.slice(1).filter((row: unknown[]) =>
    row.some((cell) => cell != null && String(cell).trim() !== '')
  )
  const rows: ParsedOrderRow[] = []
  const errors: { row: number; message: string }[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    const rowNum = i + 2 // Excel 행 번호 (1-based + header)

    const get = (idx: number | undefined): string =>
      idx !== undefined && row[idx] != null ? String(row[idx]) : ''

    const recipientName = get(mapping.recipientName)
    const phone = normalizePhone(get(mapping.phone))
    const address = get(mapping.address)
    const orderDateRaw = get(mapping.orderDate)

    const missing: string[] = []
    if (!recipientName) missing.push('받는분')
    if (!phone) missing.push('전화')
    if (!address) missing.push('주소')
    if (missing.length > 0) {
      errors.push({ row: rowNum, message: `필수 필드 누락: ${missing.join(', ')}` })
      continue
    }

    // 날짜 파싱 (4~5자리 Excel 시리얼 넘버 지원)
    let orderDate = orderDateRaw
    if (!orderDate) {
      orderDate = new Date().toISOString().split('T')[0]
    } else if (/^\d{4,5}$/.test(orderDate)) {
      const serial = Number(orderDate)
      if (serial > 1000) {
        const excelDate = new Date((serial - 25569) * 86400000)
        orderDate = excelDate.toISOString().split('T')[0]
      }
    }

    const rawPostalCode = get(mapping.postalCode)
    const postalCode = rawPostalCode ? normalizePostalCode(rawPostalCode) : undefined

    const paymentStr = get(mapping.paymentAmount)
    const paymentAmount = paymentStr ? Number(paymentStr.replace(/[^0-9.-]/g, '')) : undefined

    rows.push({
      recipientName,
      phone,
      address,
      postalCode: postalCode || undefined,
      deliveryMessage: get(mapping.deliveryMessage) || undefined,
      orderDate,
      orderNumber: get(mapping.orderNumber) || undefined,
      paymentAmount: paymentAmount && !isNaN(paymentAmount) ? paymentAmount : undefined,
      productName: get(mapping.productName) || undefined,
      productQuantity: mapping.productQuantity !== undefined
        ? Number(get(mapping.productQuantity)) || undefined
        : undefined,
      memo: get(mapping.memo) || undefined,
    })
  }

  return { rows, errors }
}
