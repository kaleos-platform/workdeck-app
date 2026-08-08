/**
 * @jest-environment node
 */
import {
  resolveMapping,
  matchesAccountNumber,
  extractCardNumberColumn,
  findBestPreset,
  type MappingPair,
  type PresetLike,
} from '../automap'

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

// 카드 이용내역 업로드 — 파일 카드/계좌번호 ↔ 등록 번호 매칭(마스킹 와일드카드).
describe('matchesAccountNumber — 마스킹 와일드카드 매칭', () => {
  test('숫자만 완전일치', () => {
    expect(matchesAccountNumber('123-456-789012', '123456789012')).toBe(true)
    expect(matchesAccountNumber('123456789012', '123456789013')).toBe(false)
  })

  test('마스킹 vs 원본 — 자리수 동일 + 위치별 일치', () => {
    expect(matchesAccountNumber('5107-****-****-1234', '5107123456781234')).toBe(true)
    expect(matchesAccountNumber('5107-****-****-1234', '5107123456781235')).toBe(false)
  })

  test('마스킹 vs 마스킹 — 노출 숫자 위치만 비교', () => {
    expect(matchesAccountNumber('5107-****-****-1234', '5107-12**-**78-1234')).toBe(true)
    expect(matchesAccountNumber('5107-****-****-1234', '5108-****-****-1234')).toBe(false)
  })

  test('마스킹 포함 자리수 불일치 → 불일치', () => {
    expect(matchesAccountNumber('5107-****-1234', '5107-****-****-1234')).toBe(false)
  })

  test('4자리 미만 → 불일치', () => {
    expect(matchesAccountNumber('123', '123')).toBe(false)
    expect(matchesAccountNumber('', '1234')).toBe(false)
  })
})

describe('extractCardNumberColumn — 카드번호 행 컬럼 추출', () => {
  test('카드번호 헤더 컬럼의 첫 비어있지 않은 값', () => {
    const headers = ['이용일자', '카드번호', '가맹점명']
    const rows = [
      ['2026-07-01', '', '가맹점A'],
      ['2026-07-02', '5107-****-****-1234', '가맹점B'],
    ]
    expect(extractCardNumberColumn(headers, rows)).toBe('5107-****-****-1234')
  })

  test('헤더 공백 포함("카드 번호")도 인식', () => {
    const headers = ['이용일자', '카드 번호']
    const rows = [['2026-07-01', '1234-5678']]
    expect(extractCardNumberColumn(headers, rows)).toBe('1234-5678')
  })

  test('카드번호 컬럼 없음 → undefined', () => {
    expect(extractCardNumberColumn(['이용일자', '가맹점명'], [['2026-07-01', 'X']])).toBeUndefined()
  })
})

// 프리셋 식별은 파일명이 아니라 파일 형식(헤더)이다. 같은 파일을 올릴 때마다 다른 프리셋이
// 적용되던 원인(동점 시 입력 순서 의존)과, 다중 적요 컬럼 프리셋이 분모 팽창으로 불리해지던
// 문제를 회귀 방어한다.
describe('findBestPreset — 형식(헤더) 기준 매칭', () => {
  const preset = (
    id: string,
    pairs: MappingPair[],
    updatedAt?: string,
    name = id
  ): PresetLike => ({
    id,
    name,
    institution: '테스트은행',
    kind: 'BANK',
    mapping: pairs,
    updatedAt,
  })

  const headers = ['거래일시', '적요', '내용', '입금액', '출금액', '거래후잔액']

  test('다중 적요 컬럼 프리셋도 분모 팽창 없이 만점 매칭', () => {
    const multi = preset('multi', [
      { headerName: '거래일시', field: 'txnDate' },
      { headerName: '적요', field: 'description' },
      { headerName: '내용', field: 'description' },
      { headerName: '입금액', field: 'deposit' },
      { headerName: '출금액', field: 'withdrawal' },
    ])
    expect(findBestPreset([multi], headers)?.id).toBe('multi')
  })

  test('동점이면 최근 갱신이 이긴다 — 입력 순서와 무관(결정적)', () => {
    const pairs: MappingPair[] = [
      { headerName: '거래일시', field: 'txnDate' },
      { headerName: '적요', field: 'description' },
      { headerName: '입금액', field: 'deposit' },
    ]
    const older = preset('a', pairs, '2026-01-01T00:00:00.000Z')
    const newer = preset('b', pairs, '2026-08-01T00:00:00.000Z')
    expect(findBestPreset([older, newer], headers)?.id).toBe('b')
    expect(findBestPreset([newer, older], headers)?.id).toBe('b')
  })

  test('동점 + updatedAt 동일 → id 사전순으로 결정적', () => {
    const pairs: MappingPair[] = [{ headerName: '거래일시', field: 'txnDate' }]
    const a = preset('a', pairs, '2026-08-01T00:00:00.000Z')
    const b = preset('b', pairs, '2026-08-01T00:00:00.000Z')
    expect(findBestPreset([b, a], headers)?.id).toBe('a')
    expect(findBestPreset([a, b], headers)?.id).toBe('a')
  })

  test('커버리지 높은 프리셋이 이긴다', () => {
    const partial = preset('partial', [
      { headerName: '거래일시', field: 'txnDate' },
      { headerName: '없는컬럼', field: 'memo' },
    ]) // 0.5 → 임계 미만
    const full = preset('full', [
      { headerName: '거래일시', field: 'txnDate' },
      { headerName: '적요', field: 'description' },
    ])
    expect(findBestPreset([partial, full], headers)?.id).toBe('full')
  })

  // 후보를 kind로 좁히지 않으므로(=preview/저장 경로 대칭), 헤더 서명만으로 은행/카드가
  // 갈리는지 확인한다.
  test('카드 헤더에 은행 프리셋이 끼어들지 않는다(헤더 서명으로 구분)', () => {
    const bank = preset('bank', [
      { headerName: '거래일시', field: 'txnDate' },
      { headerName: '적요', field: 'description' },
      { headerName: '입금액', field: 'deposit' },
    ])
    const card: PresetLike = {
      ...preset('card', [
        { headerName: '이용일', field: 'txnDate' },
        { headerName: '가맹점명', field: 'description' },
        { headerName: '이용금액', field: 'amount' },
      ]),
      kind: 'CARD',
    }
    const cardHeaders = ['이용일', '가맹점명', '이용금액', '할부']
    expect(findBestPreset([bank, card], cardHeaders)?.id).toBe('card')
    expect(findBestPreset([card, bank], headers)?.id).toBe('bank')
  })

  test('임계(0.6) 미만이면 매칭 없음 — 자동 매핑으로 폴백', () => {
    const other = preset('other', [
      { headerName: '이용일자', field: 'txnDate' },
      { headerName: '가맹점명', field: 'description' },
      { headerName: '승인번호', field: 'approvalNo' },
    ])
    expect(findBestPreset([other], headers)).toBeNull()
  })
})
