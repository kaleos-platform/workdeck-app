import * as XLSX from 'xlsx'
import { parseReconciliationFile } from '../reconciliation-parser'
import { isSyntheticExternalCode, syntheticExternalCode } from '../reconciliation-external-code'

const HEADERS = ['브랜드', '상품명', '옵션명', '위치명', 'externalCode', '현재재고', '실재고']

function build(rows: (string | number)[][], headers: string[] = HEADERS): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '재고 현황')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

// 코드 컬럼이 없는 양식(사용자가 손으로 만든 파일 / 앱 export에서 코드가 빈 경우)
const NO_CODE_HEADERS = ['브랜드', '상품명', '옵션명', '위치명', '현재재고', '실재고']

describe('parseStockStatusExport — 합성 externalCode', () => {
  it('코드 컬럼이 없으면 모든 행에 합성 코드를 채운다', () => {
    const buf = build(
      [
        ['에이엠엘', '모달 머드팬티', '누드 / 2XS(80)', '3PL', 0, 65],
        ['에이엠엘', '모달 머드팬티', '누드 / XS(85)', '3PL', 0, 75],
      ],
      NO_CODE_HEADERS
    )
    const res = parseReconciliationFile(buf, '재고조정.xlsx')
    expect(res.format).toBe('stock_status_export')
    expect(res.rows).toHaveLength(2)
    for (const r of res.rows) expect(isSyntheticExternalCode(r.externalCode)).toBe(true)
    expect(res.rows[0].externalCode).toBe(syntheticExternalCode('모달 머드팬티', '누드 / 2XS(80)'))
    expect(res.rows[0].externalCode).not.toBe(res.rows[1].externalCode)
  })

  it('공백·대소문자·NFD 변형본도 같은 합성 코드가 된다', () => {
    const clean = parseReconciliationFile(
      build([['에이엠엘', 'Modal Mud', '누드 / S', '3PL', 0, 3]], NO_CODE_HEADERS),
      'a.xlsx'
    )
    const messy = parseReconciliationFile(
      build(
        [['에이엠엘', '  modal   mud ', ' 누드 / S '.normalize('NFD'), '3PL', 0, 3]],
        NO_CODE_HEADERS
      ),
      'a.xlsx'
    )
    expect(messy.rows[0].externalCode).toBe(clean.rows[0].externalCode)
  })

  it('externalCode 컬럼이 있으면 그대로 쓴다', () => {
    const res = parseReconciliationFile(
      build([['에이엠엘', '모달 머드팬티', '누드 / S', '3PL', 'SKU-1', 0, 3]]),
      'a.xlsx'
    )
    expect(res.rows[0].externalCode).toBe('SKU-1')
    expect(isSyntheticExternalCode(res.rows[0].externalCode)).toBe(false)
  })

  it('상품명이 비면 행을 건너뛴다(합성하지 않음)', () => {
    const res = parseReconciliationFile(
      build(
        [
          ['에이엠엘', '', '누드 / S', '3PL', 0, 3],
          ['에이엠엘', '모달 머드팬티', '누드 / M', '3PL', 0, 4],
        ],
        NO_CODE_HEADERS
      ),
      'a.xlsx'
    )
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].externalOptionName).toBe('누드 / M')
  })

  it('위치명이 비어도 행을 살린다 — 보관 장소는 업로드 시 사용자가 고른다', () => {
    const res = parseReconciliationFile(
      build(
        [
          ['에이엠엘', '모달 머드팬티', '누드 / S', '', 0, 3],
          ['에이엠엘', '모달 머드팬티', '누드 / M', '', 0, 4],
        ],
        NO_CODE_HEADERS
      ),
      'a.xlsx'
    )
    expect(res.rows).toHaveLength(2)
    expect(res.rows.every((r) => r.externalLocationName === undefined)).toBe(true)
    expect(res.rows.every((r) => isSyntheticExternalCode(r.externalCode))).toBe(true)
  })

  it('위치명이 여러 개면 externalLocationName 이 유지된다(다중 위치 분배 경로)', () => {
    const res = parseReconciliationFile(
      build(
        [
          ['에이엠엘', '모달 머드팬티', '누드 / S', '3PL', 0, 3],
          ['에이엠엘', '모달 머드팬티', '누드 / S', '본사', 0, 4],
        ],
        NO_CODE_HEADERS
      ),
      'a.xlsx'
    )
    expect(res.rows.map((r) => r.externalLocationName)).toEqual(['3PL', '본사'])
    // 위치가 달라도 코드는 상품명+옵션명 기준 — 매핑은 (locationId, externalCode) 유니크라 충돌 없음
    expect(res.rows[0].externalCode).toBe(res.rows[1].externalCode)
  })
})
