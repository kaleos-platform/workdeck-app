/**
 * 배송 파일 생성기
 * 주문 데이터를 배송 방식의 포맷에 맞춰 Excel 파일로 변환한다.
 */
import * as XLSX from 'xlsx'
import { decryptPii } from '@/lib/del/encryption'
import type { DelFormatColumn } from '@/lib/del/format-templates'

type OrderWithItems = {
  recipientNameEnc: string
  recipientNameIv: string
  phoneEnc: string
  phoneIv: string
  addressEnc: string
  addressIv: string
  postalCode: string | null
  deliveryMessage: string | null
  orderDate: Date
  orderNumber: string | null
  items: { name: string; quantity: number }[]
  channel: { name: string } | null
}

/**
 * 주문 데이터로부터 배송 파일 Excel 버퍼를 생성한다.
 */
export function generateDeliveryFile(
  orders: OrderWithItems[],
  formatConfig: DelFormatColumn[]
): Buffer {
  const wb = XLSX.utils.book_new()

  // 헤더 행 생성
  const headers: Record<string, string> = {}
  for (const col of formatConfig) {
    if (col.label) {
      headers[col.column] = col.label
    }
  }

  // 데이터 행 생성
  const rows: Record<string, string | number>[] = []

  for (const order of orders) {
    // PII 복호화
    const recipientName = decryptPii(order.recipientNameEnc, order.recipientNameIv)
    const phone = decryptPii(order.phoneEnc, order.phoneIv)
    const address = decryptPii(order.addressEnc, order.addressIv)

    // 상품명/수량 합치기
    const productNames = order.items.map((i) => `${i.name}(${i.quantity})`).join(', ')
    const totalQuantity = order.items.reduce((sum, i) => sum + i.quantity, 0)

    // 필드 값 매핑
    const fieldValues: Record<string, string | number> = {
      recipientName,
      phone,
      postalCode: order.postalCode ?? '',
      fullAddress: address,
      deliveryMessage: order.deliveryMessage ?? '',
      productName: productNames,
      productQuantity: totalQuantity,
      orderNumber: order.orderNumber ?? '',
      orderDate: formatDate(order.orderDate),
      channelName: order.channel?.name ?? '',
      trackingNumber: '',
      barcode: '',
    }

    const row: Record<string, string | number> = {}
    for (const col of formatConfig) {
      if (col.field) {
        row[col.column] = fieldValues[col.field] ?? ''
      } else if (col.defaultValue) {
        row[col.column] = col.defaultValue
      } else {
        row[col.column] = ''
      }
    }
    rows.push(row)
  }

  // 워크시트 생성
  const wsData: (string | number)[][] = []

  // 헤더 행
  const headerRow: (string | number)[] = []
  for (const col of formatConfig) {
    headerRow.push(col.label || '')
  }
  wsData.push(headerRow)

  // 데이터 행
  for (const row of rows) {
    const dataRow: (string | number)[] = []
    for (const col of formatConfig) {
      dataRow.push(row[col.column] ?? '')
    }
    wsData.push(dataRow)
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData)
  XLSX.utils.book_append_sheet(wb, ws, '배송')

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
