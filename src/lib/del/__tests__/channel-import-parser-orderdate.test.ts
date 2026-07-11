/**
 * @jest-environment node
 */
import * as XLSX from 'xlsx'
import { parseWithMapping } from '../channel-import-parser'

function makeXlsxBuffer(rows: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '배송')
  const result = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  if (result instanceof ArrayBuffer) return result
  const u8 = result as Uint8Array
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

// 헤더 없이 데이터만 있는 단순 시트 (첫 행 = 헤더로 감지되지 않는 배치)
// col 0: 이름, col 1: 전화, col 2: 주소, col 3: 주문일자
const HEADERS = ['받는분', '전화', '주소', '주문일자']
const DATA_ROW = ['홍길동', '01012345678', '서울시 강남구 테헤란로 1', '2026-01-20']

const BASE_MAPPING = {
  recipientName: 0,
  phone: 1,
  address: 2,
} as const

describe('parseWithMapping — orderDate 필수 검증', () => {
  it('orderDate 매핑 없음 + FixedDate 없음 → 해당 행이 errors에 포함되고 rows에서 제외', () => {
    const buffer = makeXlsxBuffer([HEADERS, DATA_ROW])

    // orderDate 미지정 (undefined)
    const result = parseWithMapping(buffer, BASE_MAPPING)

    expect(result.rows).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/주문일자/)
  })

  it('FixedDate { fixed: "2026-01-15" } → orderDate="2026-01-15"로 정상 파싱 (회귀)', () => {
    const buffer = makeXlsxBuffer([HEADERS, DATA_ROW])

    const result = parseWithMapping(buffer, {
      ...BASE_MAPPING,
      orderDate: { fixed: '2026-01-15' },
    })

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].orderDate).toBe('2026-01-15')
  })

  it('매핑된 컬럼에 값 있는 행 → 정상 파싱 (회귀)', () => {
    const buffer = makeXlsxBuffer([HEADERS, DATA_ROW])

    const result = parseWithMapping(buffer, {
      ...BASE_MAPPING,
      orderDate: 3,
    })

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      recipientName: '홍길동',
      phone: '01012345678',
      address: '서울시 강남구 테헤란로 1',
      orderDate: '2026-01-20',
    })
  })
})
