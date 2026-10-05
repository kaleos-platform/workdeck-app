/**
 * 다중 파일 업로드 — 순수 헬퍼(자동 매칭·상태 판정·기간 겹침) 단위 테스트.
 */
import {
  defaultPresetName,
  duplicateColumnFields,
  mappingWarnings,
  unmappedDataColumns,
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

  // prod 사고 재현: 신한 grid export 는 계좌번호가 없어 파일 매칭이 실패하는데,
  // 프리셋 defaultAccountId(= 직전에 올린 계좌)가 미리 채워져 새활용 파일 22건이
  // 주거래로 조용히 적재됐다. 이제는 비워서 사용자가 고르게 한다.
  it('계좌번호 없는 파일 + 계좌 후보 여럿 → 프리셋 기본 계좌를 쓰지 않고 비운다', () => {
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
    expect(result.accountId).toBe('')
    // 프리셋 매핑은 여전히 suggestedMapping보다 우선 — withdrawal 미포함
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

describe('duplicateColumnFields — 동일 컬럼 이중 매핑 경고', () => {
  test('같은 컬럼이 description·counterparty 양쪽에 매핑되면 잡아낸다', () => {
    const dups = duplicateColumnFields({ description: [6], counterparty: [6] }, 'BANK')
    expect(dups).toHaveLength(1)
    expect(dups[0].colIdx).toBe(6)
    expect(dups[0].labels).toEqual(['적요/내용', '상대/의뢰인'])
  })

  test('description 다중 컬럼 결합은 중복이 아니다', () => {
    expect(duplicateColumnFields({ description: [2, 6], counterparty: [7] }, 'BANK')).toEqual([])
  })

  test('빈 매핑은 빈 배열', () => {
    expect(duplicateColumnFields({}, 'BANK')).toEqual([])
  })
})

describe('unmappedDataColumns — 값 있는 미매핑 컬럼 경고', () => {
  // prod 사고 재현: 신한 export 는 "적요"(거래구분)와 "내용"(상대방)이 별도 컬럼인데,
  // 프리셋이 "내용"만 두 필드에 매핑하고 "적요"를 통째로 빠뜨려 578건에서 거래구분이 소실됐다.
  const SHINHAN = ['No', '전체선택', '거래일시', '적요', '입금액', '출금액', '내용', '잔액']

  test('잘못된 프리셋(내용 이중 매핑, 적요 미매핑)에서 적요 컬럼을 잡아낸다', () => {
    const mapping = {
      txnDate: [2],
      deposit: [4],
      withdrawal: [5],
      description: [6],
      counterparty: [6],
      balanceAfter: [7],
    }
    expect(unmappedDataColumns(mapping, SHINHAN, [], 'BANK')).toEqual([3])
  })

  test('올바른 매핑이면 경고 없음 — No·전체선택은 힌트에 안 걸린다', () => {
    const mapping = {
      txnDate: [2],
      description: [3],
      deposit: [4],
      withdrawal: [5],
      counterparty: [6],
      balanceAfter: [7],
    }
    expect(unmappedDataColumns(mapping, SHINHAN, [], 'BANK')).toEqual([])
  })

  test('빈 컬럼은 경고하지 않는다', () => {
    const mapping = { txnDate: [2], description: [3], deposit: [4], withdrawal: [5] }
    expect(unmappedDataColumns(mapping, SHINHAN, [6, 7], 'BANK')).toEqual([])
  })
})

describe('mappingWarnings — grid_exceldata (16).xlsx 실제 사고 재현', () => {
  // 실제 신한 export 헤더. 입금인코드·메모는 전건 빈 컬럼이라 emptyColumns 로 들어간다.
  const HEADERS = [
    'No',
    '전체선택',
    '거래일시',
    '적요',
    '입금액',
    '출금액',
    '내용',
    '잔액',
    '거래점명',
    '입금인코드',
    '메모',
    '메모',
  ]
  const EMPTY = [9, 10, 11]

  test('사고 당시 프리셋 매핑에서 경고 2개가 나온다', () => {
    // description=내용(6), counterparty=내용(6), 적요(3) 미매핑 — 1,479건을 만든 매핑
    const broken = {
      txnDate: [2],
      description: [6],
      counterparty: [6],
      deposit: [4],
      withdrawal: [5],
      balanceAfter: [7],
      memo: [10],
    }
    const w = mappingWarnings(broken, HEADERS, EMPTY, 'BANK')
    expect(w).toHaveLength(2)
    expect(w[0]).toContain('"내용" 컬럼이')
    expect(w[0]).toContain('적요/내용 · 상대/의뢰인')
    expect(w[1]).toContain('"적요"')
    expect(w[1]).toContain('매핑되지 않았습니다')
  })

  test('올바른 매핑이면 경고가 없다 — 거래점명은 힌트에 안 걸린다', () => {
    const fixed = {
      txnDate: [2],
      description: [3],
      counterparty: [6],
      deposit: [4],
      withdrawal: [5],
      balanceAfter: [7],
      memo: [10],
    }
    expect(mappingWarnings(fixed, HEADERS, EMPTY, 'BANK')).toEqual([])
  })
})

describe('resolveInitialSelection — 계좌 후보가 하나뿐일 때', () => {
  it('후보가 1개면 자동 선택한다 — 틀릴 수 없으므로 유지', () => {
    const only = makeAccount({ id: 'solo', accountNumber: '999' })
    const result = resolveInitialSelection(makePreview({ accounts: [only], matchedPreset: null }))
    expect(result.accountId).toBe('solo')
  })
})
