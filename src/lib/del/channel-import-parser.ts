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
}

/**
 * 파일에서 헤더와 샘플 데이터를 추출한다.
 */
export function previewFile(buffer: ArrayBuffer): FilePreview {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const jsonRows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })

  const headers = (jsonRows[0] ?? []).map((v) => String(v ?? ''))
  const dataRows = jsonRows.slice(1)
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

  const dataRows = jsonRows.slice(1) // 헤더 제외
  const rows: ParsedOrderRow[] = []
  const errors: { row: number; message: string }[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    const rowNum = i + 2 // Excel 행 번호 (1-based + header)

    const get = (idx: number | undefined): string =>
      idx !== undefined && row[idx] != null ? String(row[idx]) : ''

    const recipientName = get(mapping.recipientName)
    const phone = get(mapping.phone)
    const address = get(mapping.address)
    const orderDateRaw = get(mapping.orderDate)

    if (!recipientName || !phone || !address) {
      errors.push({ row: rowNum, message: '필수 필드(받는분, 전화, 주소) 누락' })
      continue
    }

    // 날짜 파싱
    let orderDate = orderDateRaw
    if (!orderDate) {
      orderDate = new Date().toISOString().split('T')[0]
    } else if (/^\d{5}$/.test(orderDate)) {
      // Excel 시리얼 넘버
      const excelDate = new Date((Number(orderDate) - 25569) * 86400000)
      orderDate = excelDate.toISOString().split('T')[0]
    }

    const paymentStr = get(mapping.paymentAmount)
    const paymentAmount = paymentStr ? Number(paymentStr.replace(/[^0-9.-]/g, '')) : undefined

    rows.push({
      recipientName,
      phone,
      address,
      postalCode: get(mapping.postalCode) || undefined,
      deliveryMessage: get(mapping.deliveryMessage) || undefined,
      orderDate,
      orderNumber: get(mapping.orderNumber) || undefined,
      paymentAmount: paymentAmount && !isNaN(paymentAmount) ? paymentAmount : undefined,
      productName: get(mapping.productName) || undefined,
      productQuantity: mapping.productQuantity !== undefined
        ? Number(get(mapping.productQuantity)) || undefined
        : undefined,
    })
  }

  return { rows, errors }
}
