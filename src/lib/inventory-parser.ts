import * as XLSX from 'xlsx'

// 파일 형식
export type InventoryFileType = 'INVENTORY_HEALTH' | 'VENDOR_ITEM_METRICS'

// 파싱 결과 행
export type ParsedInventoryRow = {
  productId: string
  optionId: string
  skuId: string | null
  productName: string
  optionName: string | null
  category: string | null
  // 재고 (INVENTORY_HEALTH)
  availableStock: number | null
  inboundStock: number | null
  productGrade: string | null
  restockQty: number | null
  restockDate: string | null
  estimatedDepletion: string | null
  storageFee: number | null
  isItemWinner: boolean | null
  returns30d: number | null
  // 매출/판매
  revenue7d: number | null
  revenue30d: number | null
  salesQty7d: number | null
  salesQty30d: number | null
  // VENDOR_ITEM_METRICS 전용
  visitors: number | null
  views: number | null
  cartAdds: number | null
  conversionRate: number | null
  itemWinnerRate: number | null
  totalRevenue: number | null
  totalSales: number | null
  totalCancelAmt: number | null
  totalCancelled: number | null
  // 보관기간별 재고
  stock1to30d: number | null
  stock31to45d: number | null
  stock46to60d: number | null
  stock61to120d: number | null
  stock121to180d: number | null
  stock181plusD: number | null
}

export type InventoryParseResult = {
  rows: ParsedInventoryRow[]
  fileType: InventoryFileType
}

// ─── 유틸리티 ──────────────────────────────────────────────

/** 숫자 파싱: 콤마 제거, "-" → null, "데이터 없음" → null */
function parseNum(val: unknown): number | null {
  if (val == null) return null
  const s = String(val).trim()
  if (s === '' || s === '-' || s === '데이터 없음') return null
  const cleaned = s.replace(/,/g, '').replace(/%$/, '')
  const n = Number(cleaned)
  return isNaN(n) ? null : n
}

/** 정수 파싱 */
function parseInt_(val: unknown): number | null {
  const n = parseNum(val)
  return n != null ? Math.round(n) : null
}

/** 문자열 파싱: 빈 값 → null */
function parseStr(val: unknown): string | null {
  if (val == null) return null
  const s = String(val).trim()
  return s === '' || s === '-' ? null : s
}

// ─── INVENTORY_HEALTH 파서 ─────────────────────────────────

/**
 * 2-row 헤더를 병합하여 단일 헤더 배열로 변환
 * 예: Row 0 "최근 매출" + Row 1 "지난 7일" → "최근 매출_지난 7일"
 */
function mergeHeaders(row0: unknown[], row1: unknown[]): string[] {
  const headers: string[] = []
  let lastParent = ''
  for (let i = 0; i < row0.length; i++) {
    const parent = String(row0[i] ?? '').trim().replace(/\n/g, ' ')
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

function parseInventoryHealthRow(row: Record<string, unknown>): ParsedInventoryRow | null {
  const productId = parseStr(row['등록상품 ID'] ?? row['등록상품ID'])
  const optionId = parseStr(row['옵션 ID'] ?? row['옵션ID'])
  if (!productId || !optionId) return null

  const itemWinnerStr = parseStr(row['아이템위너'])
  const isItemWinner = itemWinnerStr === '아이템위너' ? true : itemWinnerStr === null ? null : false

  return {
    productId,
    optionId,
    skuId: parseStr(row['SKU ID']),
    productName: String(row['등록상품명'] ?? '').trim(),
    optionName: parseStr(row['옵션명']),
    category: null,
    availableStock: parseInt_(row['판매가능재고 (실시간 기준)'] ?? row['판매가능재고']),
    inboundStock: parseInt_(row['입고예정재고(실시간 기준)'] ?? row['입고예정재고']),
    productGrade: parseStr(row['상품등급']),
    restockQty: parseInt_(row['추가입고 추천수량'] ?? row['추가입고추천수량']),
    restockDate: parseStr(row['추가입고날짜 (입고예정일)'] ?? row['추가입고날짜']),
    estimatedDepletion: parseStr(row['재고예상 소진일'] ?? row['재고예상소진일']),
    storageFee: parseInt_(row['이번달 누적보관료(전일자 기준)'] ?? row['이번달 누적보관료']),
    isItemWinner,
    returns30d: parseInt_(row['고객반품 지난 30일(전일자 기준)'] ?? row['고객반품_지난 30일']),
    revenue7d: parseNum(row['최근 매출 (번들 매출 제외)_지난 7일'] ?? row['최근 매출_지난 7일']),
    revenue30d: parseNum(row['최근 매출 (번들 매출 제외)_지난 30일'] ?? row['최근 매출_지난 30일']),
    salesQty7d: parseInt_(row['최근 판매수량_지난 7일']),
    salesQty30d: parseInt_(row['최근 판매수량_지난 30일']),
    // vendor_item_metrics 전용 (null)
    visitors: null,
    views: null,
    cartAdds: null,
    conversionRate: null,
    itemWinnerRate: null,
    totalRevenue: null,
    totalSales: null,
    totalCancelAmt: null,
    totalCancelled: null,
    // 보관기간별 재고
    stock1to30d: parseInt_(row['보관기간별 판매가능재고 (전일자 기준)_1~30일'] ?? row['보관기간별 판매가능재고_1~30일']),
    stock31to45d: parseInt_(row['보관기간별 판매가능재고 (전일자 기준)_31~45일'] ?? row['보관기간별 판매가능재고_31~45일']),
    stock46to60d: parseInt_(row['보관기간별 판매가능재고 (전일자 기준)_46~60일'] ?? row['보관기간별 판매가능재고_46~60일']),
    stock61to120d: parseInt_(row['보관기간별 판매가능재고 (전일자 기준)_61~120일'] ?? row['보관기간별 판매가능재고_61~120일']),
    stock121to180d: parseInt_(row['보관기간별 판매가능재고 (전일자 기준)_121~180일'] ?? row['보관기간별 판매가능재고_121~180일']),
    stock181plusD: parseInt_(row['보관기간별 판매가능재고 (전일자 기준)_181일+'] ?? row['보관기간별 판매가능재고_181일+']),
  }
}

// ─── VENDOR_ITEM_METRICS 파서 ──────────────────────────────

function parseVendorItemRow(row: Record<string, unknown>): ParsedInventoryRow | null {
  const optionId = parseStr(row['옵션 ID'] ?? row['옵션ID'])
  const productId = parseStr(row['등록상품ID'] ?? row['등록상품 ID'])
  if (!optionId) return null

  const convRate = parseNum(row['구매전환율'])
  const winnerRate = parseNum(row['아이템위너 비율(%)'] ?? row['아이템위너 비율'])

  return {
    productId: productId ?? '',
    optionId,
    skuId: null,
    productName: String(row['상품명'] ?? '').trim(),
    optionName: parseStr(row['옵션명']),
    category: parseStr(row['카테고리']),
    // 재고 관련 (null)
    availableStock: null,
    inboundStock: null,
    productGrade: null,
    restockQty: null,
    restockDate: null,
    estimatedDepletion: null,
    storageFee: null,
    isItemWinner: winnerRate != null ? winnerRate > 0 : null,
    returns30d: null,
    // 매출 (vendor_item_metrics의 매출은 기간 구분 없음 → revenue30d로 매핑)
    revenue7d: null,
    revenue30d: parseNum(row['매출(원)'] ?? row['매출']),
    salesQty7d: null,
    salesQty30d: parseInt_(row['판매량']),
    // vendor_item_metrics 전용
    visitors: parseInt_(row['방문자']),
    views: parseInt_(row['조회']),
    cartAdds: parseInt_(row['장바구니']),
    conversionRate: convRate,
    itemWinnerRate: winnerRate,
    totalRevenue: parseNum(row['총 매출(원)'] ?? row['총 매출']),
    totalSales: parseInt_(row['총 판매수']),
    totalCancelAmt: parseNum(row['총 취소 금액(원)'] ?? row['총 취소 금액']),
    totalCancelled: parseInt_(row['총 취소된 상품수']),
    // 보관기간별 재고 (null)
    stock1to30d: null,
    stock31to45d: null,
    stock46to60d: null,
    stock61to120d: null,
    stock121to180d: null,
    stock181plusD: null,
  }
}

// ─── 메인 파서 ─────────────────────────────────────────────

/**
 * 재고/상품성과 엑셀을 파싱한다.
 * 파일 형식을 자동 감지하여 적절한 파서를 선택한다.
 */
export function parseInventoryExcel(buffer: ArrayBuffer): InventoryParseResult {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('엑셀에 시트가 없습니다')

  const ws = wb.Sheets[sheetName]
  const rawData = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
  if (rawData.length < 2) throw new Error('데이터가 부족합니다')

  const row0 = rawData[0] as unknown[]

  // 파일 형식 감지
  const headerStr = row0.map(String).join('|')

  if (headerStr.includes('판매가능재고') || headerStr.includes('SKU ID')) {
    // INVENTORY_HEALTH: 2-row 헤더
    const row1 = rawData[1] as unknown[]
    const headers = mergeHeaders(row0, row1)
    const dataRows = rawData.slice(2)

    const rows: ParsedInventoryRow[] = []
    for (const rawRow of dataRows) {
      const arr = rawRow as unknown[]
      const record: Record<string, unknown> = {}
      for (let i = 0; i < headers.length; i++) {
        record[headers[i]] = arr[i]
      }
      const parsed = parseInventoryHealthRow(record)
      if (parsed) rows.push(parsed)
    }

    return { rows, fileType: 'INVENTORY_HEALTH' }
  }

  if (headerStr.includes('구매전환율') || headerStr.includes('아이템위너 비율')) {
    // VENDOR_ITEM_METRICS: 1-row 헤더
    const headers = row0.map(String)
    const dataRows = rawData.slice(1)

    const rows: ParsedInventoryRow[] = []
    for (const rawRow of dataRows) {
      const arr = rawRow as unknown[]
      const record: Record<string, unknown> = {}
      for (let i = 0; i < headers.length; i++) {
        record[headers[i]] = arr[i]
      }
      const parsed = parseVendorItemRow(record)
      if (parsed) rows.push(parsed)
    }

    return { rows, fileType: 'VENDOR_ITEM_METRICS' }
  }

  throw new Error(
    `지원하지 않는 파일 형식입니다. 재고 건강성(inventory_health) 또는 셀러 인사이트(vendor_item_metrics) 엑셀을 업로드해주세요.`
  )
}
