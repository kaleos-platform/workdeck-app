/**
 * @jest-environment node
 */
import * as XLSX from 'xlsx'
import { parseWithMapping, previewFile } from '../channel-import-parser'

function makeXlsxBuffer(rows: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '발주발송관리')
  const result = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  if (result instanceof ArrayBuffer) return result
  const u8 = result as Uint8Array
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

const SMARTSTORE_NOTICE =
  "◈ 다운로드 받은 파일로 '엑셀 일괄발송' 처리하는 방법\n" +
  '1. 엑셀 파일에 아래 네 가지 항목을 확인 후 입력해주세요.\n' +
  '- 상품주문번호, 배송방법, 택배사, 송장번호\n' +
  '※ 파일 업로드 시, 1행 삭제 후 업로드 부탁 드립니다.'

const SMARTSTORE_HEADERS = [
  '상품주문번호',
  '주문번호',
  '배송속성',
  '배송방법',
  '택배사',
  '송장번호',
  '수취인명',
  '수취인연락처1',
  '통합배송지',
  '우편번호',
  '배송메세지',
  '결제일',
  '상품명',
  '수량',
]

const SMARTSTORE_DATA_ROW = [
  '2026052852073231',
  '2026052849495941',
  '일반배송',
  '택배,등기,소포',
  'CJ대한통운',
  '',
  '홍길동',
  '1012345678',
  '서울시 강남구 테헤란로 1',
  '6234',
  '문 앞에 놓아주세요',
  '2026-05-28',
  '테스트 상품',
  '2',
]

describe('previewFile', () => {
  it('안내문 다음 배송 컬럼 행을 헤더로 사용하고 실제 데이터 행만 집계한다', () => {
    const buffer = makeXlsxBuffer([
      [SMARTSTORE_NOTICE, '', '', '◈ 각 항목 입력 방법 배송방법 - 택배,등기,소포'],
      SMARTSTORE_HEADERS,
      SMARTSTORE_DATA_ROW,
    ])

    const preview = previewFile(buffer)

    expect(preview.headers.slice(0, 6)).toEqual([
      '상품주문번호',
      '주문번호',
      '배송속성',
      '배송방법',
      '택배사',
      '송장번호',
    ])
    expect(preview.totalRows).toBe(1)
    expect(preview.sampleRows).toHaveLength(1)
    expect(preview.sampleRows[0][0]).toBe('2026052852073231')
  })

  it('첫 행이 배송 컬럼이면 기존처럼 첫 행을 헤더로 사용한다', () => {
    const buffer = makeXlsxBuffer([SMARTSTORE_HEADERS, SMARTSTORE_DATA_ROW])

    const preview = previewFile(buffer)

    expect(preview.headers[0]).toBe('상품주문번호')
    expect(preview.totalRows).toBe(1)
    expect(preview.sampleRows[0][6]).toBe('홍길동')
  })
})

describe('parseWithMapping', () => {
  it('안내문과 헤더 행은 주문으로 파싱하지 않고 실제 엑셀 행 번호를 보존한다', () => {
    const buffer = makeXlsxBuffer([
      [SMARTSTORE_NOTICE, '', '', '◈ 각 항목 입력 방법 배송방법 - 택배,등기,소포'],
      SMARTSTORE_HEADERS,
      SMARTSTORE_DATA_ROW,
    ])

    const result = parseWithMapping(buffer, {
      recipientName: 6,
      phone: 7,
      address: 8,
      postalCode: 9,
      deliveryMessage: 10,
      orderDate: 11,
      orderNumber: 1,
      productName: 12,
      productQuantity: 13,
    })

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      sourceRowNumber: 3,
      recipientName: '홍길동',
      phone: '01012345678',
      address: '서울시 강남구 테헤란로 1',
      postalCode: '06234',
      deliveryMessage: '문 앞에 놓아주세요',
      orderDate: '2026-05-28',
      orderNumber: '2026052849495941',
      productName: '테스트 상품',
      productQuantity: 2,
    })
  })
})
