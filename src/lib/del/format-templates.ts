/**
 * 배송 파일 포맷 정의
 * 배송 방식별로 Excel 파일 생성 시 사용할 컬럼 매핑을 정의한다.
 * 포맷은 사용자가 업로드한 양식 파일로부터 생성된다.
 */

/** 매핑 가능한 필드 목록 */
export type DelFieldMapping =
  | 'recipientName'
  | 'phone'
  | 'postalCode'
  | 'fullAddress'
  | 'deliveryMessage'
  | 'productName'
  | 'productQuantity'
  | 'orderNumber'
  | 'orderDate'
  | 'channelName'
  | 'trackingNumber'
  | 'barcode'

/** 단일 컬럼 매핑 정의 */
export type DelFormatColumn = {
  column: string // Excel 컬럼 문자: "A", "B", "C", ...
  field: DelFieldMapping | null // 매핑 필드 or null(빈 컬럼)
  label: string // 헤더 텍스트
  defaultValue?: string // 고정 기본값
}

/** 필드 매핑 레이블 (UI 표시용) */
export const FIELD_LABELS: Record<DelFieldMapping, string> = {
  recipientName: '받는분',
  phone: '전화번호',
  postalCode: '우편번호',
  fullAddress: '주소',
  deliveryMessage: '배송메시지',
  productName: '품목명',
  productQuantity: '수량',
  orderNumber: '주문번호',
  orderDate: '주문일자',
  channelName: '판매채널',
  trackingNumber: '운송장번호',
  barcode: '바코드',
}

/**
 * 빈 포맷 컬럼 하나를 생성한다.
 */
export function createEmptyColumn(columnLetter: string): DelFormatColumn {
  return { column: columnLetter, field: null, label: '' }
}

/**
 * 인덱스(0-based)를 Excel 컬럼 문자로 변환한다.
 * 0 → "A", 25 → "Z", 26 → "AA"
 */
export function indexToColumnLetter(index: number): string {
  let result = ''
  let n = index
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result
    n = Math.floor(n / 26) - 1
  }
  return result
}
