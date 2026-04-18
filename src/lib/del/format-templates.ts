/**
 * 배송 파일 포맷 템플릿 시스템
 * 배송 방식별로 Excel 파일 생성 시 사용할 컬럼 매핑을 정의한다.
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

/** 한진택배 프리셋 */
export const HANJIN_FORMAT: DelFormatColumn[] = [
  { column: 'A', field: null, label: '' },
  { column: 'B', field: null, label: '' },
  { column: 'C', field: 'recipientName', label: '받으시는분' },
  { column: 'D', field: 'phone', label: '받으시는분 전화' },
  { column: 'E', field: null, label: '' },
  { column: 'F', field: 'postalCode', label: '받는분우편번호' },
  { column: 'G', field: 'fullAddress', label: '받는분총주소' },
  { column: 'H', field: null, label: '' },
  { column: 'I', field: null, label: '' },
  { column: 'J', field: 'productName', label: '품목명' },
  { column: 'K', field: 'productQuantity', label: '수량' },
  { column: 'L', field: null, label: '운임Type', defaultValue: '선불' },
  { column: 'M', field: null, label: '지불조건', defaultValue: '선불' },
  { column: 'N', field: 'deliveryMessage', label: '특기사항' },
]

/** 3PL 프리셋 */
export const THREE_PL_FORMAT: DelFormatColumn[] = [
  { column: 'A', field: 'recipientName', label: '성명' },
  { column: 'B', field: 'phone', label: '전화번호' },
  { column: 'C', field: 'phone', label: '핸드폰번호' },
  { column: 'D', field: 'fullAddress', label: '주소' },
  { column: 'E', field: 'deliveryMessage', label: '배송메세지' },
  { column: 'F', field: 'productName', label: '품목명' },
  { column: 'G', field: 'productQuantity', label: '수량' },
  { column: 'H', field: 'trackingNumber', label: '운송장번호' },
  { column: 'I', field: 'orderNumber', label: '채널별 주문번호' },
  { column: 'J', field: 'barcode', label: '바코드' },
  { column: 'K', field: 'orderDate', label: '주문일' },
  { column: 'L', field: 'channelName', label: '쇼핑몰명' },
]

/** 프리셋 목록 */
export const FORMAT_PRESETS: { id: string; name: string; columns: DelFormatColumn[] }[] = [
  { id: 'hanjin', name: '한진택배', columns: HANJIN_FORMAT },
  { id: '3pl', name: '3PL', columns: THREE_PL_FORMAT },
]

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
