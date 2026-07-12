/**
 * 다중 파일 업로드 — 순수 헬퍼(자동 매칭·상태 판정·기간 겹침) 단위 테스트.
 */
import {
  findOverlappingFileIds,
  isMappingValid,
  mappingEntriesToState,
  resolveInitialSelection,
  resolveReadiness,
  stateToMappingEntries,
  type Account,
  type PreviewResponse,
} from '../types'

const HEADERS = ['거래일시', '적요', '입금액', '출금액', '거래후잔액']

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acct-1',
    name: '기업은행 사업용',
    kind: 'BANK',
    institution: '기업은행',
    holder: null,
    accountNumber: '123-456-789',
    ...overrides,
  }
}

function makePreview(overrides: {
  accounts?: Account[]
  accountNumber?: string
  matchedPreset?: PreviewResponse['matchedPreset']
  kind?: 'BANK' | 'CARD'
}): PreviewResponse {
  return {
    fileName: 'test.csv',
    preview: {
      headers: HEADERS,
      sampleRows: [],
      totalRows: 10,
      emptyColumns: [],
      sheetNames: ['Sheet1'],
      activeSheet: 'Sheet1',
      preamble: { accountNumber: overrides.accountNumber },
    },
    kind: overrides.kind ?? 'BANK',
    institution: '기업은행',
    suggestedMapping: [
      { headerName: '거래일시', field: 'txnDate' },
      { headerName: '적요', field: 'description' },
      { headerName: '입금액', field: 'deposit' },
      { headerName: '출금액', field: 'withdrawal' },
    ],
    matchedPreset: overrides.matchedPreset ?? null,
    accounts: overrides.accounts ?? [],
  }
}

describe('resolveInitialSelection', () => {
  it('파일 계좌번호와 일치하는 계좌를 자동 선택하고 그 계좌 kind를 따른다', () => {
    const acct = makeAccount()
    const result = resolveInitialSelection(
      makePreview({ accounts: [acct], accountNumber: '123-456-789' })
    )
    expect(result.accountId).toBe('acct-1')
    expect(result.kind).toBe('BANK')
    expect(result.matchedAccount?.id).toBe('acct-1')
    expect(result.mapping['txnDate']).toEqual([0])
  })

  it('매칭 없고 후보가 유일하면 유일 후보 선택', () => {
    const acct = makeAccount({ accountNumber: '999' })
    const result = resolveInitialSelection(makePreview({ accounts: [acct] }))
    expect(result.accountId).toBe('acct-1')
  })

  it('매칭 없고 후보 여러 개면 미선택', () => {
    const result = resolveInitialSelection(
      makePreview({
        accounts: [
          makeAccount({ id: 'a1', accountNumber: '111' }),
          makeAccount({ id: 'a2', accountNumber: '222' }),
        ],
      })
    )
    expect(result.accountId).toBe('')
  })

  it('프리셋 기본 계좌는 파일 계좌 매칭 다음 순위', () => {
    const a1 = makeAccount({ id: 'a1', accountNumber: '111' })
    const a2 = makeAccount({ id: 'a2', accountNumber: '222' })
    const result = resolveInitialSelection(
      makePreview({
        accounts: [a1, a2],
        matchedPreset: {
          id: 'p1',
          name: '프리셋',
          institution: '기업은행',
          kind: 'BANK',
          mapping: [
            { headerName: '거래일시', field: 'txnDate' },
            { headerName: '적요', field: 'description' },
            { headerName: '입금액', field: 'deposit' },
          ],
          defaultAccountId: 'a2',
        },
      })
    )
    expect(result.accountId).toBe('a2')
    // 프리셋 매핑이 suggestedMapping보다 우선 — withdrawal 미포함
    expect(result.mapping['withdrawal']).toBeUndefined()
  })
})

describe('resolveReadiness', () => {
  const validMapping = mappingEntriesToState(
    [
      { headerName: '거래일시', field: 'txnDate' },
      { headerName: '적요', field: 'description' },
      { headerName: '입금액', field: 'deposit' },
    ],
    HEADERS
  )

  it('계좌 + 유효 매핑 → matched', () => {
    expect(resolveReadiness({ accountId: 'a1', mapping: validMapping, kind: 'BANK' })).toBe(
      'matched'
    )
  })

  it('계좌 미선택 → needs_review', () => {
    expect(resolveReadiness({ accountId: '', mapping: validMapping, kind: 'BANK' })).toBe(
      'needs_review'
    )
  })

  it('매핑 불완전 → needs_review', () => {
    expect(resolveReadiness({ accountId: 'a1', mapping: {}, kind: 'BANK' })).toBe('needs_review')
  })
})

describe('isMappingValid', () => {
  it('BANK는 입금/출금 중 하나 필수', () => {
    const mapping = mappingEntriesToState(
      [
        { headerName: '거래일시', field: 'txnDate' },
        { headerName: '적요', field: 'description' },
      ],
      HEADERS
    )
    expect(isMappingValid(mapping, 'BANK').ok).toBe(false)
  })
})

describe('state ↔ entries 왕복', () => {
  it('mapping 왕복 시 필드·순서 보존', () => {
    const entries = [
      { headerName: '거래일시', field: 'txnDate' },
      { headerName: '적요', field: 'description' },
      { headerName: '거래후잔액', field: 'description' },
    ]
    const state = mappingEntriesToState(entries, HEADERS)
    expect(state['description']).toEqual([1, 4])
    expect(stateToMappingEntries(state, HEADERS)).toEqual(entries)
  })
})

describe('findOverlappingFileIds', () => {
  function item(id: string, accountId: string, from?: string, to?: string) {
    return {
      id,
      accountId,
      preview: from ? { preview: { preamble: { periodFrom: from, periodTo: to } } } : undefined,
    }
  }

  it('같은 계좌 + 기간 겹침 → 두 파일 모두 표시', () => {
    const result = findOverlappingFileIds([
      item('f1', 'a1', '2026-06-01', '2026-06-30'),
      item('f2', 'a1', '2026-06-15', '2026-07-15'),
    ])
    expect(result).toEqual(new Set(['f1', 'f2']))
  })

  it('같은 계좌라도 기간이 분리되면 미표시', () => {
    const result = findOverlappingFileIds([
      item('f1', 'a1', '2026-05-01', '2026-05-31'),
      item('f2', 'a1', '2026-06-01', '2026-06-30'),
    ])
    expect(result.size).toBe(0)
  })

  it('다른 계좌는 기간이 겹쳐도 미표시', () => {
    const result = findOverlappingFileIds([
      item('f1', 'a1', '2026-06-01', '2026-06-30'),
      item('f2', 'a2', '2026-06-01', '2026-06-30'),
    ])
    expect(result.size).toBe(0)
  })

  it('기간 정보 없는 파일은 판정 제외', () => {
    const result = findOverlappingFileIds([
      item('f1', 'a1', '2026-06-01', '2026-06-30'),
      item('f2', 'a1'),
    ])
    expect(result.size).toBe(0)
  })
})
