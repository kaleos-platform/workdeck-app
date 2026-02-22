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
  // NCA 공통
  material: string | null
  // NCA 동영상 지표
  videoViews3s: number | null
  avgPlayTime: number | null
  videoViews25p: number | null
  videoViews50p: number | null
  videoViews75p: number | null
  videoViews100p: number | null
  costPerView3s: number | null
  engagements: number | null
  engagementRate: number | null
}

// 파일 포맷 유형
type AdFileFormat = 'KEYWORD' | 'NCA'

// 포맷별 필수 컬럼
const REQUIRED_COLUMNS: Record<AdFileFormat, { label: string; keys: string[] }[]> = {
  KEYWORD: [
    { label: '날짜', keys: ['날짜'] },
    { label: '광고유형', keys: ['광고유형'] },
    { label: '캠페인 ID', keys: ['캠페인 ID', '캠페인ID'] },
    { label: '캠페인명', keys: ['캠페인명', '캠페인 이름'] },
    { label: '노출수', keys: ['노출수'] },
    { label: '클릭수', keys: ['클릭수'] },
    { label: '광고비', keys: ['광고비'] },
  ],
  NCA: [
    { label: '날짜', keys: ['날짜'] },
    { label: '광고 목표', keys: ['광고 목표'] },
    { label: '캠페인 ID', keys: ['캠페인 ID'] },
    { label: '캠페인 이름', keys: ['캠페인 이름'] },
    { label: '노출수', keys: ['노출수'] },
    { label: '클릭수', keys: ['클릭수'] },
    { label: '집행 광고비', keys: ['집행 광고비'] },
  ],
}

// 컬럼 검증 오류 타입
export type ColumnValidationDetail = {
  missingColumns: string[] // 누락된 필수 컬럼 label 목록
  foundColumns: string[] // 파일에서 발견된 실제 헤더 목록
}

// 컬럼 검증 오류 클래스
export class ColumnValidationError extends Error {
  constructor(public readonly detail: ColumnValidationDetail) {
    super('필수 컬럼이 누락되었습니다')
    this.name = 'ColumnValidationError'
  }
}

// 파일 포맷 감지: 첫 번째 행 헤더 기준
function detectFormat(firstRow: Record<string, unknown>): AdFileFormat {
  if ('집행 광고비' in firstRow || '광고 목표' in firstRow) return 'NCA'
  return 'KEYWORD'
}

// 필수 컬럼 존재 여부 검증
function validateColumns(rows: Record<string, unknown>[], format: AdFileFormat): void {
  if (rows.length === 0) return
  const foundColumns = Object.keys(rows[0])
  const required = REQUIRED_COLUMNS[format]
  const missingColumns = required
    .filter(({ keys }) => !keys.some((k) => foundColumns.includes(k)))
    .map(({ label }) => label)
  if (missingColumns.length > 0) {
    throw new ColumnValidationError({ missingColumns, foundColumns })
  }
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

// nullable 숫자 파싱: "-", "" → null, 그 외 parseFloat
function parseNullNum(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return null
  const str = String(raw).replace(/,/g, '').trim()
  const n = parseFloat(str)
  return isNaN(n) ? null : n
}

// nullable 퍼센트 파싱: "-", "" → null, "12.34%" → 12.34
function parseNullPercent(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return null
  const str = String(raw).trim().replace('%', '').replace(/,/g, '')
  const n = parseFloat(str)
  return isNaN(n) ? null : n
}

// 한 행을 포맷에 따라 정규화
function normalizeRow(row: Record<string, unknown>, format: AdFileFormat): ParsedRow {
  if (format === 'NCA') {
    return {
      date: parseKorDate(row['날짜']),
      adType: String(row['광고 목표'] ?? '').trim(),
      campaignId: String(row['캠페인 ID'] ?? '').trim(),
      campaignName: String(row['캠페인 이름'] ?? '제목 없는 캠페인').trim(),
      adGroup: null,
      placement: parseNullStr(row['광고 노출 지면']),
      productName: parseNullStr(row['광고집행 상품명']),
      optionId: parseNullStr(row['광고집행 옵션 ID']),
      keyword: parseNullStr(row['노출된 키워드']),
      impressions: parseNum(row['노출수'], parseInt),
      clicks: parseNum(row['클릭수'], parseInt),
      adCost: parseNum(row['집행 광고비'], parseFloat),
      ctr: parsePercent(row['클릭률']),
      orders1d: 0,
      revenue1d: parseNum(row['첫구매를 통한 광고 전환 매출'], parseFloat),
      roas1d: parsePercent(row['첫구매를 통한 광고수익률']),
      material: parseNullStr(row['소재']),
      videoViews3s: parseNullNum(row['동영상 3초 조회']),
      avgPlayTime: parseNullNum(row['평균 재생 시간']),
      videoViews25p: parseNullNum(row['25% 재생수']),
      videoViews50p: parseNullNum(row['50% 재생수']),
      videoViews75p: parseNullNum(row['75% 재생수']),
      videoViews100p: parseNullNum(row['100% 재생수']),
      costPerView3s: parseNullNum(row['동영상 3초 조회당 비용']),
      engagements: parseNullNum(row['참여수']),
      engagementRate: parseNullPercent(row['참여율']),
    }
  }

  // KEYWORD 포맷 기존 로직
  return {
    date: parseKorDate(row['날짜']),
    adType: String(row['광고유형'] ?? '').trim(),
    campaignId: String(row['캠페인 ID'] ?? row['캠페인ID'] ?? '').trim(),
    campaignName: String(row['캠페인명'] ?? row['캠페인 이름'] ?? '제목 없는 캠페인').trim(),
    adGroup: parseNullStr(row['광고그룹명']),
    placement: parseNullStr(row['광고 노출 지면']),
    productName: parseNullStr(row['광고집행 상품명']),
    optionId: parseNullStr(row['광고집행 옵션ID']),
    keyword: parseNullStr(row['키워드']),
    impressions: parseNum(row['노출수'], parseInt),
    clicks: parseNum(row['클릭수'], parseInt),
    adCost: parseNum(row['광고비'], parseFloat),
    ctr: parsePercent(row['클릭률']),
    orders1d: parseNum(row['직접 주문수(1일)'], parseInt),
    revenue1d: parseNum(row['직접 전환매출액(1일)'], parseFloat),
    roas1d: parsePercent(row['직접광고수익률(1일)']),
    material: null,
    videoViews3s: null,
    avgPlayTime: null,
    videoViews25p: null,
    videoViews50p: null,
    videoViews75p: null,
    videoViews100p: null,
    costPerView3s: null,
    engagements: null,
    engagementRate: null,
  }
}

// 파싱된 sheet 행 배열을 정규화된 ParsedRow 배열로 변환
function normalizeRows(rows: Record<string, unknown>[]): ParsedRow[] {
  if (rows.length === 0) return []

  // 포맷 감지
  const format = detectFormat(rows[0])

  // 컬럼 검증 (오류 시 ColumnValidationError throw)
  validateColumns(rows, format)

  return rows
    .map((row) => normalizeRow(row, format))
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
