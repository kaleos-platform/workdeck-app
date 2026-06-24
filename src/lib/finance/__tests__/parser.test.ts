/**
 * @jest-environment node
 */
import {
  previewFinanceFile,
  parseFinanceWithMapping,
  parseAmount,
  normalizeDateOnly,
  normalizeDateTime,
  type FinColumnMapping,
} from '../parser'
import { resolveMapping, type MappingPair } from '../automap'

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function csvRow(cells: string[]): string {
  return cells.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')
}
function toBuf(rows: string[][]): ArrayBuffer {
  const str = rows.map(csvRow).join('\n')
  const enc = new TextEncoder().encode(str)
  return enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength)
}

// ─── 단위 정규화 ──────────────────────────────────────────────────────────────

describe('값 정규화', () => {
  test('parseAmount — 콤마/빈값/문자', () => {
    expect(parseAmount('687,184')).toBe(687184)
    expect(parseAmount('5,000,000')).toBe(5000000)
    expect(parseAmount('')).toBe(0)
    expect(parseAmount('-')).toBe(0)
    expect(parseAmount(0)).toBe(0)
  })
  test('normalizeDateOnly — 다양한 구분자', () => {
    expect(normalizeDateOnly('2026-03-16 08:39:01')).toBe('2026-03-16')
    expect(normalizeDateOnly('2026.05.01')).toBe('2026-05-01')
    expect(normalizeDateOnly('2026.05.28 18:45:11')).toBe('2026-05-28')
  })
  test('normalizeDateTime — 시간 보존', () => {
    expect(normalizeDateTime('2026-03-16 08:39:01')).toBe('2026-03-16 08:39:01')
    expect(normalizeDateTime('2026.05.01')).toBe('2026-05-01')
  })
})

// ─── 기업은행 (preamble 6행, 출금,입금 순서, 시간 포함) ────────────────────────

const IBK = [
  ['거래내역조회_입출식 예금'],
  ['계좌번호:213-112757-01-019 (성동구)  조회기준일:2026년 01월 02일'],
  ['예금주명:주식회사 의식주의  예금종류:보통예금'],
  ['현재잔액:99원'],
  ['조회시작일자:2025-01-01  조회종료일자:2025-12-31'],
  [''],
  ['거래일시', '출금', '입금', '거래후 잔액', '거래내용', '거래구분'],
  ['2026-03-16 08:39:01', '0', '500000', '500099', '정산입금', '이체'],
  ['2026-03-17 10:00:00', '120000', '0', '380099', '택배비', '이체'],
]
const IBK_MAP: FinColumnMapping = {
  txnDate: 0,
  withdrawal: 1,
  deposit: 2,
  balanceAfter: 3,
  description: 4,
}

describe('기업은행', () => {
  test('preamble 스킵 + 헤더 감지 + 계좌·기간 추출', () => {
    const p = previewFinanceFile(toBuf(IBK))
    expect(p.headers).toEqual(['거래일시', '출금', '입금', '거래후 잔액', '거래내용', '거래구분'])
    expect(p.totalRows).toBe(2)
    expect(p.preamble.accountNumber).toBe('213-112757-01-019')
    expect(p.preamble.periodFrom).toBe('2025-01-01')
    expect(p.preamble.periodTo).toBe('2025-12-31')
  })
  test('입금/출금 → direction+amount', () => {
    const { rows, errors } = parseFinanceWithMapping(toBuf(IBK), IBK_MAP, 'BANK', 'acc-ibk')
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ direction: 'IN', amount: 500000, balanceAfter: 500099 })
    expect(rows[1]).toMatchObject({ direction: 'OUT', amount: 120000, balanceAfter: 380099 })
    expect(rows[0].txnDate).toBe('2026-03-16 08:39:01')
  })
})

// ─── 하나은행 (입금,출금 순서 반대) ───────────────────────────────────────────

const HANA_BANK = [
  ['거래내역'],
  [''],
  ['예금주명 : 주식회사 의식주의'],
  ['계좌번호 : 010-339989-80404'],
  ['조회기간 : 2026-05-01 ~ 2026-05-31'],
  [''],
  ['거래일시', '적요', '입금', '출금', '거래후잔액', '구분'],
  ['2026-05-27 18:35:17', '주식회사 의식주의', '5000000', '0', '5000000', '타행이체'],
  ['2026-05-27 20:00:44', '하나카드기업', '0', '687184', '4312816', '하나카드'],
]
const HANA_BANK_MAP: FinColumnMapping = {
  txnDate: 0,
  description: 1,
  deposit: 2,
  withdrawal: 3,
  balanceAfter: 4,
}

describe('하나은행 (입금/출금 순서 반대)', () => {
  test('헤더 위치 기반 매핑으로 방향 정상', () => {
    const { rows } = parseFinanceWithMapping(toBuf(HANA_BANK), HANA_BANK_MAP, 'BANK', 'acc-hana')
    expect(rows[0]).toMatchObject({ direction: 'IN', amount: 5000000 })
    expect(rows[1]).toMatchObject({ direction: 'OUT', amount: 687184 })
  })
  test('계좌번호·기간(틸드) 추출', () => {
    const p = previewFinanceFile(toBuf(HANA_BANK))
    expect(p.preamble.accountNumber).toBe('010-339989-80404')
    expect(p.preamble.periodFrom).toBe('2026-05-01')
  })
})

// ─── 우리은행 (지급=출금, dotted datetime, 3행 preamble) ───────────────────────

const WOORI = [
  ['우리은행 거래내역조회'],
  ['계좌번호 : 1005004803825        예금주 : 주식회사 의식주의'],
  ['조회기간 : 2026.05.01~2026.05.31'],
  ['No.', '거래일시', '적요', '기재내용', '지급(원)', '입금(원)', '거래후 잔액(원)'],
  ['1', '2026.05.29 17:28:02', '모바일', '신한주의식주의', '20000500', '0', '80094854'],
  ['2', '2026.05.29 15:02:02', 'F/B', '토스페이먼츠', '0', '3221001', '27877513'],
]
const WOORI_MAP: FinColumnMapping = {
  txnDate: 1,
  description: 2,
  counterparty: 3,
  withdrawal: 4,
  deposit: 5,
  balanceAfter: 6,
}

describe('우리은행 (지급=출금, dotted)', () => {
  test('지급→OUT, 입금→IN, dotted 날짜 정규화', () => {
    const { rows } = parseFinanceWithMapping(toBuf(WOORI), WOORI_MAP, 'BANK', 'acc-woori')
    expect(rows[0]).toMatchObject({ direction: 'OUT', amount: 20000500 })
    expect(rows[1]).toMatchObject({ direction: 'IN', amount: 3221001 })
    expect(rows[0].txnDate).toBe('2026-05-29 17:28:02')
  })
})

// ─── 신한은행 (헤더 0행) ──────────────────────────────────────────────────────

const SHINHAN = [
  ['No', '전체선택', '거래일시', '적요', '입금액', '출금액', '내용', '잔액'],
  ['1', '', '2026.05.28 18:45:11', '대체', '0', '6575000', '김OO', '365000'],
  ['2', '', '2026.05.28 18:45:11', '대체', '5260000', '0', '성장지원', '6940000'],
]
const SHINHAN_MAP: FinColumnMapping = {
  txnDate: 2,
  description: 3,
  deposit: 4,
  withdrawal: 5,
  counterparty: 6,
  balanceAfter: 7,
}

describe('신한은행 (헤더 0행)', () => {
  test('헤더 0행 감지 + 방향', () => {
    const p = previewFinanceFile(toBuf(SHINHAN))
    expect(p.headers[2]).toBe('거래일시')
    const { rows } = parseFinanceWithMapping(toBuf(SHINHAN), SHINHAN_MAP, 'BANK', 'acc-shinhan')
    expect(rows[0]).toMatchObject({ direction: 'OUT', amount: 6575000 })
    expect(rows[1]).toMatchObject({ direction: 'IN', amount: 5260000 })
  })
})

// ─── 하나카드 (멀티라인 헤더, 취소구분, 승인번호) ─────────────────────────────

const HANA_CARD = [
  [
    'NO',
    '이용일자',
    '매입일자',
    '카드번호',
    '구분',
    '매출\n구분',
    '승인번호',
    '가맹점명',
    '가맹점번호',
    '매출금액',
    '취소\n구분',
    '환가료',
    '할인금액',
    '결제일자',
    '부가세',
  ],
  [
    '1',
    '2026.05.01',
    '2026.05.02',
    '4289-****-****-7900',
    '국내',
    '국내일시불',
    '26205019',
    '샐러드랩',
    '00943106682',
    '86900',
    '정상',
    '0',
    '0',
    '2026-05-25',
    '0',
  ],
  [
    '6',
    '2026.05.07',
    '2026.05.11',
    '4289-****-****-7900',
    '국내',
    '국내일시불',
    '24206619',
    '티머니',
    '00980159222',
    '33300',
    '정상',
    '0',
    '0',
    '2026-06-25',
    '0',
  ],
  [
    '7',
    '2026.05.07',
    '2026.05.27',
    '4289-****-****-7900',
    '국내',
    '국내일시불',
    '24206619',
    '티머니',
    '00980159222',
    '33300',
    '취소',
    '0',
    '0',
    '2026-06-25',
    '0',
  ],
]
const CARD_MAP: FinColumnMapping = {
  txnDate: 1,
  description: 7,
  amount: 9,
  cancelFlag: 10,
  approvalNo: 6,
  settleDate: 13,
}

describe('하나카드 (멀티라인 헤더)', () => {
  test('멀티라인 헤더 감지 + 카드 필드 파싱', () => {
    const p = previewFinanceFile(toBuf(HANA_CARD))
    expect(p.totalRows).toBe(3)
    expect(p.headers[6]).toBe('승인번호')
    const { rows } = parseFinanceWithMapping(toBuf(HANA_CARD), CARD_MAP, 'CARD', 'acc-card')
    expect(rows[0]).toMatchObject({
      direction: 'OUT',
      amount: 86900,
      approvalNo: '26205019',
      cancelFlag: '정상',
    })
    expect(rows[0].txnDate).toBe('2026-05-01')
  })
})

// ─── 적요/내용 다중 컬럼 결합 ─────────────────────────────────────────────────

describe('적요/내용 다중 컬럼 결합', () => {
  // SHINHAN: 적요(idx 3) + 내용(idx 6) 둘 다 존재
  const MULTI_MAP: FinColumnMapping = {
    txnDate: 2,
    description: [3, 6], // 적요 + 내용
    deposit: 4,
    withdrawal: 5,
    counterparty: undefined,
    balanceAfter: 7,
  }

  test('description 2개 컬럼 → " / " 로 결합', () => {
    const { rows } = parseFinanceWithMapping(toBuf(SHINHAN), MULTI_MAP, 'BANK', 'acc-shinhan')
    expect(rows[0].description).toBe('대체 / 김OO')
    expect(rows[1].description).toBe('대체 / 성장지원')
  })

  test('빈 컬럼은 결합에서 제외(구분자 없이 한쪽만)', () => {
    const rowsWithBlank = [
      SHINHAN[0],
      ['1', '', '2026.05.28 18:45:11', '대체', '0', '6575000', '', '365000'], // 내용 빈칸
    ]
    const { rows } = parseFinanceWithMapping(toBuf(rowsWithBlank), MULTI_MAP, 'BANK', 'acc-shinhan')
    expect(rows[0].description).toBe('대체')
  })

  test('단일 컬럼 매핑은 결합 구분자 영향 없음', () => {
    const { rows } = parseFinanceWithMapping(toBuf(SHINHAN), SHINHAN_MAP, 'BANK', 'acc-shinhan')
    expect(rows[0].description).toBe('대체')
  })

  // 프론트 와이어 경로 그대로: {headerName,field}[] → resolveMapping → parseFinanceWithMapping
  test('와이어 경로(pairs→resolveMapping→parse)로도 " / " 결합', () => {
    const headers = previewFinanceFile(toBuf(SHINHAN)).headers
    const pairs: MappingPair[] = [
      { headerName: '거래일시', field: 'txnDate' },
      { headerName: '적요', field: 'description' }, // 다중 #1
      { headerName: '내용', field: 'description' }, // 다중 #2
      { headerName: '입금액', field: 'deposit' },
      { headerName: '출금액', field: 'withdrawal' },
    ]
    const resolved = resolveMapping(headers, pairs)
    expect(resolved.description).toEqual([3, 6])
    const { rows } = parseFinanceWithMapping(toBuf(SHINHAN), resolved, 'BANK', 'acc-shinhan')
    expect(rows[0].description).toBe('대체 / 김OO')
    expect(rows[1].description).toBe('대체 / 성장지원')
  })
})

// ─── 중복/변경 판정 (identity ↔ content) ──────────────────────────────────────

describe('identity / content 키', () => {
  test('은행: 동일 거래 → identity 동일', () => {
    const a = parseFinanceWithMapping(toBuf(IBK), IBK_MAP, 'BANK', 'acc-ibk').rows
    const b = parseFinanceWithMapping(toBuf(IBK), IBK_MAP, 'BANK', 'acc-ibk').rows
    expect(a[0].identityKey).toBe(b[0].identityKey)
    expect(a[0].identityKey).not.toBe(a[1].identityKey)
  })

  test('카드: 정상 vs 취소 (동일 승인번호) → identity 다름', () => {
    const { rows } = parseFinanceWithMapping(toBuf(HANA_CARD), CARD_MAP, 'CARD', 'acc-card')
    // row[1]=정상 24206619, row[2]=취소 24206619
    expect(rows[1].approvalNo).toBe(rows[2].approvalNo)
    expect(rows[1].cancelFlag).toBe('정상')
    expect(rows[2].cancelFlag).toBe('취소')
    expect(rows[1].identityKey).not.toBe(rows[2].identityKey)
  })

  test('카드: 가승인→매입확정 (매입일/금액 변동) → identity 동일, content 다름', () => {
    const base = [HANA_CARD[0], HANA_CARD[1]]
    // 동일 승인번호·이용일·정상, 매입일/금액만 변경
    const changed = [
      HANA_CARD[0],
      [
        '1',
        '2026.05.01',
        '2026.05.04',
        '4289-****-****-7900',
        '국내',
        '국내일시불',
        '26205019',
        '샐러드랩',
        '00943106682',
        '90000',
        '정상',
        '0',
        '0',
        '2026-05-25',
        '0',
      ],
    ]
    const a = parseFinanceWithMapping(toBuf(base), CARD_MAP, 'CARD', 'acc-card').rows[0]
    const b = parseFinanceWithMapping(toBuf(changed), CARD_MAP, 'CARD', 'acc-card').rows[0]
    expect(a.identityKey).toBe(b.identityKey)
    expect(a.contentHash).not.toBe(b.contentHash)
  })
})
