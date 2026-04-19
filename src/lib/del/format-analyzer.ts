/**
 * 업로드된 배송사 양식 파일의 헤더/샘플 데이터로부터 DelFormatColumn[]을 추론한다.
 * 헤더 키워드 매칭(1순위) + 값 패턴(보조)으로 각 컬럼에 매핑 필드를 부여한다.
 */
import { type DelFieldMapping, type DelFormatColumn, indexToColumnLetter } from './format-templates'

const HEADER_KEYWORDS: Record<DelFieldMapping, string[]> = {
  recipientName: ['받으시는분', '받는사람', '받는분', '수하인', '수취인', '성명', '이름'],
  phone: [
    '휴대폰번호',
    '핸드폰번호',
    '휴대폰',
    '핸드폰',
    '연락처',
    '전화번호',
    '전화',
    '핸펀',
    'phone',
  ],
  postalCode: ['받는분우편번호', '우편번호', '우편', 'zipcode', 'zip'],
  fullAddress: ['받는분주소', '받는분총주소', '총주소', '배송지주소', '배송지', '주소'],
  deliveryMessage: ['배송메시지', '배송메세지', '배송요청', '특기사항', '요청사항'],
  productName: ['상품명', '품목명', '품명', '품목'],
  productQuantity: ['수량', 'qty'],
  orderNumber: ['채널별주문번호', '주문번호', '오더번호', 'ordernumber', 'orderno', 'order'],
  orderDate: ['주문일자', '주문일', '결제일', '결제일자', 'orderdate'],
  channelName: ['쇼핑몰명', '판매채널', '쇼핑몰', '채널', '몰'],
  trackingNumber: ['운송장번호', '송장번호', '운송장', '송장', 'tracking'],
  barcode: ['바코드', 'barcode'],
}

/** 헤더 텍스트를 매칭용으로 정규화한다. */
function normalizeHeader(raw: string): string {
  return raw
    .replace(/\s+/g, '')
    .replace(/[()[\]·•:,_\-/]/g, '')
    .toLowerCase()
}

type KeywordEntry = { field: DelFieldMapping; keyword: string }

/** 길이 내림차순으로 정렬된 키워드 엔트리 (긴 매칭 우선) */
const SORTED_KEYWORDS: KeywordEntry[] = Object.entries(HEADER_KEYWORDS)
  .flatMap(([field, keywords]) =>
    keywords.map((keyword) => ({
      field: field as DelFieldMapping,
      keyword: normalizeHeader(keyword),
    }))
  )
  .sort((a, b) => b.keyword.length - a.keyword.length)

function matchHeader(header: string, used: Set<DelFieldMapping>): DelFieldMapping | null {
  const normalized = normalizeHeader(header)
  if (!normalized) return null
  for (const entry of SORTED_KEYWORDS) {
    if (normalized.includes(entry.keyword) && !used.has(entry.field)) {
      return entry.field
    }
  }
  return null
}

const PHONE_PATTERN = /^01[016789]\d{7,8}$/
const POSTAL_PATTERN = /^\d{5}$/
const DATE_PATTERN = /^\d{4}[-./]\d{1,2}[-./]\d{1,2}/
const ADDRESS_KEYWORDS = ['시', '구', '동', '로', '길', '읍', '면', '군']

function matchValue(values: string[], used: Set<DelFieldMapping>): DelFieldMapping | null {
  const nonEmpty = values.map((v) => v.trim()).filter(Boolean)
  if (nonEmpty.length === 0) return null

  let phoneHits = 0
  let postalHits = 0
  let dateHits = 0
  let addressHits = 0

  for (const v of nonEmpty) {
    const digits = v.replace(/[^0-9]/g, '')
    if (PHONE_PATTERN.test(digits)) phoneHits++
    if (
      POSTAL_PATTERN.test(digits) &&
      digits.length === v.replace(/[^0-9]/g, '').length &&
      digits === v
    ) {
      postalHits++
    }
    if (DATE_PATTERN.test(v)) dateHits++
    if (ADDRESS_KEYWORDS.some((k) => v.includes(k)) && /[가-힣]/.test(v) && v.length >= 6) {
      addressHits++
    }
  }

  const total = nonEmpty.length
  const threshold = Math.max(1, Math.floor(total * 0.5))

  if (phoneHits >= threshold && !used.has('phone')) return 'phone'
  if (postalHits >= threshold && !used.has('postalCode')) return 'postalCode'
  if (dateHits >= threshold && !used.has('orderDate')) return 'orderDate'
  if (addressHits >= threshold && !used.has('fullAddress')) return 'fullAddress'
  return null
}

/**
 * 헤더와 샘플 행으로부터 컬럼 매핑 초안을 생성한다.
 * 동일 필드가 여러 컬럼에 잡히면 첫 컬럼만 채택하고 나머지는 null 로 둔다.
 */
export function analyzeFormat(headers: string[], sampleRows: string[][]): DelFormatColumn[] {
  const used = new Set<DelFieldMapping>()
  return Array.from({ length: headers.length }, (_, i) => {
    const column = indexToColumnLetter(i)
    const label = String(headers[i] ?? '').trim()

    const columnValues = sampleRows.map((row) => String(row?.[i] ?? ''))

    let field: DelFieldMapping | null = matchHeader(label, used)
    if (!field) field = matchValue(columnValues, used)
    if (field) used.add(field)

    return { column, field, label }
  })
}
