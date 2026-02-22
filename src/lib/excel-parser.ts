import * as XLSX from 'xlsx'

// DB 삽입용 정규화된 행 타입
export type ParsedRow = {
  date: Date
  adType: string
  campaignId: string
  campaignName: string
  adGroup: string | null
  placement: string | null
  productName: string | null
  optionId: string | null
  keyword: string | null
  impressions: number
  clicks: number
  adCost: number
  ctr: number
  orders1d: number
  revenue1d: number
  roas1d: number
}

// 퍼센트 문자열 파싱: "12.34%" → 12.34, "5.6689E-4" → 0.00056689 * 100
function parsePercent(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return 0
  const str = String(raw).trim().replace('%', '')
  const n = parseFloat(str)
  return isNaN(n) ? 0 : n
}

// 날짜 파싱: "20260207" → Seoul 자정 기준 UTC DateTime
function parseKorDate(raw: unknown): Date {
  const str = String(raw ?? '').trim()
  if (str.length === 8) {
    const year = str.slice(0, 4)
    const month = str.slice(4, 6)
    const day = str.slice(6, 8)
    // Asia/Seoul(+09:00) 자정을 UTC로 변환
    return new Date(`${year}-${month}-${day}T00:00:00+09:00`)
  }
  return new Date(NaN)
}

// nullable 문자열: "-", "" → null
function parseNullStr(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const str = String(raw).trim()
  if (str === '-' || str === '') return null
  return str
}

// 숫자 문자열 파싱: 쉼표 제거 후 변환
function parseNum(raw: unknown, parser: (s: string) => number): number {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return 0
  const str = String(raw).replace(/,/g, '').trim()
  const n = parser(str)
  return isNaN(n) ? 0 : n
}

// 파싱된 sheet 행 배열을 정규화된 ParsedRow 배열로 변환하는 공통 함수
function normalizeRows(rows: Record<string, unknown>[]): ParsedRow[] {
  return rows
    .map((row) => ({
      date: parseKorDate(row['날짜']),
      adType: String(row['광고유형'] ?? '').trim(),
      campaignId: String(row['캠페인 ID'] ?? row['캠페인ID'] ?? '').trim(),
      campaignName: String(row['캠페인명'] ?? '').trim(),
      adGroup: parseNullStr(row['광고그룹명']),
      placement: parseNullStr(row['광고 노출 지면']),
      productName: parseNullStr(row['광고집행 상품명']),
      optionId: parseNullStr(row['광고집행 옵션ID']),
      keyword: parseNullStr(row['키워드']),
      impressions: parseNum(row['노출수'], parseInt),
      clicks: parseNum(row['클릭수'], parseInt),
      adCost: parseNum(row['광고비'], parseFloat),
      ctr: parsePercent(row['클릭률']),
      // 쿠팡 Excel 직접 전환 1일 지표 (직접광고수익률, 직접 전환매출액, 직접 주문수)
      orders1d: parseNum(row['직접 주문수(1일)'], parseInt),
      revenue1d: parseNum(row['직접 전환매출액(1일)'], parseFloat),
      roas1d: parsePercent(row['직접광고수익률(1일)']),
    }))
    .filter((row) => row.campaignId !== '' && !isNaN(row.date.getTime()))
}

// Excel(.xlsx) 버퍼를 파싱하여 정규화된 행 배열 반환
export function parseExcelBuffer(buffer: ArrayBuffer): ParsedRow[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false })
  return normalizeRows(rows)
}

// CSV 버퍼를 파싱하여 정규화된 행 배열 반환
// xlsx 라이브러리의 CSV 파싱 기능을 활용 (BOM 포함 UTF-8 지원)
export function parseCsvBuffer(buffer: ArrayBuffer): ParsedRow[] {
  const workbook = XLSX.read(buffer, { type: 'array', codepage: 65001 })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false })
  return normalizeRows(rows)
}

// 파싱된 행에서 데이터 기간 추출
export function detectPeriod(rows: ParsedRow[]): {
  periodStart: Date
  periodEnd: Date
} {
  const times = rows.map((r) => r.date.getTime())
  return {
    periodStart: new Date(Math.min(...times)),
    periodEnd: new Date(Math.max(...times)),
  }
}
