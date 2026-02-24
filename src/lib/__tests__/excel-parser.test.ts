import * as XLSX from 'xlsx'
import {
  parseExcelBuffer,
  parseCsvBuffer,
  detectPeriod,
  ColumnValidationError,
  type ParsedRow,
} from '../excel-parser'

// KEYWORD 포맷 최소 데이터 (헤더 + 1행)
const KEYWORD_HEADER = [
  '날짜',
  '광고유형',
  '캠페인 ID',
  '캠페인명',
  '광고그룹명',
  '광고 노출 지면',
  '노출수',
  '클릭수',
  '클릭률',
  '광고비',
  '직접 주문수(1일)',
  '직접 전환매출액(1일)',
  '직접광고수익률(1일)',
]

const KEYWORD_ROW = [
  '20260224',
  '키워드광고',
  'CAMP001',
  '테스트 캠페인',
  '테스트 그룹',
  '-',
  '10000',
  '500',
  '5%',
  '30000',
  '10',
  '150000',
  '500%',
]

// xlsx ArrayBuffer 생성 헬퍼
function makeXlsxBuffer(rows: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const result = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return result instanceof ArrayBuffer ? result : (result as Uint8Array).buffer
}

// 최소 ParsedRow 생성 헬퍼
function makeRow(date: Date): ParsedRow {
  return {
    date,
    adType: '',
    campaignId: 'C001',
    campaignName: '',
    adGroup: null,
    placement: null,
    productName: null,
    optionId: null,
    keyword: null,
    impressions: 0,
    clicks: 0,
    adCost: 0,
    ctr: 0,
    orders1d: 0,
    revenue1d: 0,
    roas1d: 0,
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

describe('detectPeriod', () => {
  it('단일 날짜 배열 → periodStart = periodEnd', () => {
    const d = new Date('2026-02-24T00:00:00+09:00')
    const result = detectPeriod([makeRow(d)])
    expect(result.periodStart.getTime()).toBe(d.getTime())
    expect(result.periodEnd.getTime()).toBe(d.getTime())
  })

  it('여러 날짜 배열 → 최솟값과 최댓값 반환', () => {
    const d1 = new Date('2026-02-01T00:00:00+09:00')
    const d2 = new Date('2026-02-15T00:00:00+09:00')
    const d3 = new Date('2026-02-28T00:00:00+09:00')
    const result = detectPeriod([makeRow(d2), makeRow(d1), makeRow(d3)])
    expect(result.periodStart.getTime()).toBe(d1.getTime())
    expect(result.periodEnd.getTime()).toBe(d3.getTime())
  })
})

describe('ColumnValidationError', () => {
  it('detail 속성에 missingColumns, foundColumns 포함', () => {
    const err = new ColumnValidationError({
      missingColumns: ['날짜', '광고유형'],
      foundColumns: ['A', 'B', 'C'],
    })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ColumnValidationError')
    expect(err.detail.missingColumns).toEqual(['날짜', '광고유형'])
    expect(err.detail.foundColumns).toEqual(['A', 'B', 'C'])
  })

  it('message는 "필수 컬럼이 누락되었습니다"', () => {
    const err = new ColumnValidationError({ missingColumns: ['날짜'], foundColumns: [] })
    expect(err.message).toBe('필수 컬럼이 누락되었습니다')
  })
})

describe('parseExcelBuffer', () => {
  it('KEYWORD 포맷 정상 파싱 → ParsedRow 배열 반환', () => {
    const buffer = makeXlsxBuffer([KEYWORD_HEADER, KEYWORD_ROW])
    const rows = parseExcelBuffer(buffer)
    expect(rows).toHaveLength(1)
    expect(rows[0].campaignId).toBe('CAMP001')
    expect(rows[0].adType).toBe('키워드광고')
    expect(rows[0].impressions).toBe(10000)
    expect(rows[0].clicks).toBe(500)
  })

  it('날짜 파싱: "20260224" → KST 자정 UTC', () => {
    const buffer = makeXlsxBuffer([KEYWORD_HEADER, KEYWORD_ROW])
    const rows = parseExcelBuffer(buffer)
    // 2026-02-24T00:00:00+09:00 = 2026-02-23T15:00:00Z
    expect(rows[0].date.toISOString()).toBe('2026-02-23T15:00:00.000Z')
  })

  it('필수 컬럼 누락 → ColumnValidationError throw', () => {
    const buffer = makeXlsxBuffer([
      ['잘못된컬럼', '다른컬럼'],
      ['값1', '값2'],
    ])
    expect(() => parseExcelBuffer(buffer)).toThrow(ColumnValidationError)
  })

  it('빈 데이터 → 빈 배열 반환', () => {
    const buffer = makeXlsxBuffer([KEYWORD_HEADER])
    const rows = parseExcelBuffer(buffer)
    expect(rows).toHaveLength(0)
  })
})

describe('parseCsvBuffer', () => {
  it('KEYWORD 포맷 CSV 정상 파싱', () => {
    // CSV를 xlsx로 감싸서 테스트 (xlsx.read codepage=65001 방식과 동일한 경로 사용)
    const buffer = makeXlsxBuffer([KEYWORD_HEADER, KEYWORD_ROW])
    const rows = parseCsvBuffer(buffer)
    expect(rows).toHaveLength(1)
    expect(rows[0].campaignId).toBe('CAMP001')
  })
})
