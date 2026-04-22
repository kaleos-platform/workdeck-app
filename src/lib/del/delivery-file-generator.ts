/**
 * 배송 파일 생성기
 * 주문 데이터를 배송 방식의 포맷에 맞춰 Excel 파일로 변환한다.
 *
 * 옵션별 필드 오버라이드: 아이템에 매칭된 옵션이 있고, 해당 옵션·배송방식에
 * `DelShippingMethodLabel` 이 존재하면 `overrides[field]` 값이 카탈로그 기본보다 우선한다.
 */
import * as XLSX from 'xlsx'
import { decryptPii } from '@/lib/del/encryption'
import type { DelFieldMapping, DelFormatColumn } from '@/lib/del/format-templates'

type ItemLine = {
  name: string // 원본 텍스트 (fallback)
  quantity: number
  option?: {
    name: string
    product: { name: string }
  } | null
  overrides?: Partial<Record<DelFieldMapping, string>> | null
}

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
  items: ItemLine[]
  channel: { name: string } | null
}

/**
 * 한 아이템에 대해 지정 field 의 표시 값을 결정한다.
 * 우선순위: overrides[field] > 카탈로그 기본(productName의 경우 product.name + option.name) > 원본 name/빈값
 */
function resolveItemField(item: ItemLine, field: DelFieldMapping): string | null {
  const ov = item.overrides?.[field]
  if (ov && ov.trim() !== '') return ov
  if (field === 'productName') {
    if (item.option) {
      const p = item.option.product.name.trim()
      const o = item.option.name.trim()
      return p && o ? `${p} ${o}` : p || o || item.name
    }
    return item.name
  }
  // barcode 등은 override 없으면 null (빈 값 fallback은 호출부에서)
  return null
}

/**
 * 주문 데이터로부터 배송 파일 Excel 버퍼를 생성한다.
 */
export function generateDeliveryFile(
  orders: OrderWithItems[],
  formatConfig: DelFormatColumn[]
): Buffer {
  const wb = XLSX.utils.book_new()

  // 데이터 행 생성
  const rows: Record<string, string | number>[] = []

  for (const order of orders) {
    // PII 복호화
    const recipientName = decryptPii(order.recipientNameEnc, order.recipientNameIv)
    const phone = decryptPii(order.phoneEnc, order.phoneIv)
    const address = decryptPii(order.addressEnc, order.addressIv)

    // 상품명: 아이템별로 오버라이드/매칭 적용 후 concat
    const productNames = order.items
      .map((i) => {
        const n = resolveItemField(i, 'productName') ?? i.name
        return `${n}(${i.quantity})`
      })
      .join(', ')
    const totalQuantity = order.items.reduce((sum, i) => sum + i.quantity, 0)
    // 바코드: override 있는 아이템만 모아 concat (없으면 빈 문자열)
    const barcodes = order.items
      .map((i) => resolveItemField(i, 'barcode'))
      .filter((v): v is string => !!v)
      .join(', ')

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
      barcode: barcodes,
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
