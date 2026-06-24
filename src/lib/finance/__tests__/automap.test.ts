/**
 * @jest-environment node
 */
import { resolveMapping, type MappingPair } from '../automap'

// 프론트가 보내는 와이어 포맷({headerName, field}[])이 파서가 쓰는 인덱스 매핑으로
// 올바르게 해석되는지 검증. 특히 동일 필드(적요/내용)에 다중 헤더 → 인덱스 배열 분기.
describe('resolveMapping — 헤더명 → 인덱스(+다중 필드 배열)', () => {
  const headers = ['거래일시', '적요', '입금', '출금', '거래후잔액', '내용']

  test('단일 필드 → 인덱스(스칼라)', () => {
    const pairs: MappingPair[] = [{ headerName: '거래일시', field: 'txnDate' }]
    expect(resolveMapping(headers, pairs)).toEqual({ txnDate: 0 })
  })

  test('동일 필드 다중 헤더 → 인덱스 배열(추가 순서 보존)', () => {
    const pairs: MappingPair[] = [
      { headerName: '적요', field: 'description' },
      { headerName: '내용', field: 'description' },
    ]
    expect(resolveMapping(headers, pairs)).toEqual({ description: [1, 5] })
  })

  test('pair 순서 = 결합 순서 (역순 입력)', () => {
    const pairs: MappingPair[] = [
      { headerName: '내용', field: 'description' },
      { headerName: '적요', field: 'description' },
    ]
    expect(resolveMapping(headers, pairs)).toEqual({ description: [5, 1] })
  })

  test('존재하지 않는 헤더는 무시(스칼라 유지)', () => {
    const pairs: MappingPair[] = [
      { headerName: '없는컬럼', field: 'description' },
      { headerName: '적요', field: 'description' },
    ]
    expect(resolveMapping(headers, pairs)).toEqual({ description: 1 })
  })
})
