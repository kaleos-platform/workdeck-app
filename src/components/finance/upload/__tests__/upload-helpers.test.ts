/**
 * 다중 파일 업로드 — 순수 헬퍼(자동 매칭·상태 판정·기간 겹침) 단위 테스트.
 */
import {
  defaultPresetName,
  findOverlappingFileIds,
  isMappingDirty,
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

// 규칙 이름은 파일명이 아니라 "선택된 계좌"에서 파생한다 — 파일명이 달라질 때마다
// 다른 이름의 규칙이 생겨 매번 다른 규칙이 적용되던 문제 회귀 방어.
describe('defaultPresetName / presetName 파생', () => {
  it('신규 형식이면 계좌 기관명 + 종류로 이름 생성(파일명 무관)', () => {
    const acct = makeAccount({ accountNumber: '123-456-789' })
    const result = resolveInitialSelection(
      makePreview({ accounts: [acct], accountNumber: '123-456-789' })
    )
    // '기업은행'은 이미 종류 라벨('은행')을 포함 → 접미사 없음
    expect(result.presetName).toBe('기업은행')
  })

  it('기관명에 종류가 이미 있으면 중복 접미사 없음, 없으면 붙인다', () => {
    expect(defaultPresetName(makeAccount({ institution: '하나은행' }), 'BANK')).toBe('하나은행')
    expect(defaultPresetName(makeAccount({ institution: '삼성카드' }), 'CARD')).toBe('삼성카드')
    expect(defaultPresetName(makeAccount({ institution: '토스' }), 'BANK')).toBe('토스 은행')
  })

  it('계좌가 없으면 파일명 추정 기관명으로 폴백', () => {
    expect(defaultPresetName(null, 'BANK', '국민은행')).toBe('국민은행')
    expect(defaultPresetName(null, 'BANK')).toBe('')
  })

  it('기억된 규칙이 있으면 그 이름을 그대로 사용', () => {
    const acct = makeAccount({ accountNumber: '123-456-789' })
    const result = resolveInitialSelection(
      makePreview({
        accounts: [acct],
        accountNumber: '123-456-789',
        matchedPreset: {
          id: 'p1',
          name: '내 기업은행 규칙',
          institution: '기업은행',
          kind: 'BANK',
          mapping: [{ headerName: '거래일시', field: 'txnDate' }],
          defaultAccountId: null,
        },
      })
    )
    expect(result.presetName).toBe('내 기업은행 규칙')
  })
})

// 매핑을 고쳤는데 저장 스위치가 꺼져 있으면 다음 업로드에 옛 매핑(적요 등)이 되살아난다.
describe('isMappingDirty', () => {
  const preset = {
    id: 'p1',
    name: '규칙',
    institution: '기업은행',
    kind: 'BANK',
    mapping: [
      { headerName: '거래일시', field: 'txnDate' },
      { headerName: '적요', field: 'description' },
      { headerName: '입금액', field: 'deposit' },
    ],
    defaultAccountId: null,
  }

  it('프리셋과 동일하면 false(필드 순서 무관)', () => {
    const state = mappingEntriesToState(preset.mapping, HEADERS)
    expect(isMappingDirty(state, HEADERS, preset)).toBe(false)
  })

  it('컬럼을 제거하면 true', () => {
    const state = mappingEntriesToState(preset.mapping, HEADERS)
    delete state['description']
    expect(isMappingDirty(state, HEADERS, preset)).toBe(true)
  })

  it('다중 컬럼 중 하나만 빼도 true', () => {
    const multi = {
      ...preset,
      mapping: [...preset.mapping, { headerName: '거래후잔액', field: 'description' }],
    }
    const state = mappingEntriesToState(preset.mapping, HEADERS)
    expect(isMappingDirty(state, HEADERS, multi)).toBe(true)
  })

  it('기억된 규칙이 없으면 항상 false', () => {
    expect(isMappingDirty({ txnDate: [0] }, HEADERS, null)).toBe(false)
  })
})
