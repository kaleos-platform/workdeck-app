/** @jest-environment node */
import {
  canApprove,
  deriveStage,
  parseAutofixState,
  parseTriage,
  shouldWriteNote,
  triageReason,
} from '../autofix-status'

const c = (text: string, dateCreated: string) => ({ text, dateCreated })

test('빈 목록·무관한 노트는 none', () => {
  expect(parseAutofixState([]).kind).toBe('none')
  expect(parseAutofixState([c('원인 확인 중', '2026-11-21T01:00:00Z')]).kind).toBe('none')
})

test('API 순서와 무관하게 가장 최근 autofix 노트를 쓴다', () => {
  const s = parseAutofixState([
    c('autofix:failed boom', '2026-11-21T03:00:00Z'),
    c('autofix:request', '2026-11-21T01:00:00Z'),
    c('잡담', '2026-11-21T05:00:00Z'),
  ])
  expect(s).toMatchObject({ kind: 'failed', reason: 'boom', at: '2026-11-21T03:00:00Z' })
})

test('pr URL 은 kaleos-platform GitHub 만 허용', () => {
  const ok = parseAutofixState([
    c('autofix:pr https://github.com/kaleos-platform/x/pull/1', '2026-11-21T01:00:00Z'),
  ])
  expect(ok).toMatchObject({ kind: 'pr', prUrl: 'https://github.com/kaleos-platform/x/pull/1' })
  const bad = parseAutofixState([c('autofix:pr https://evil.example/x', '2026-11-21T01:00:00Z')])
  expect(bad.kind).toBe('pr')
  expect(bad.prUrl).toBeUndefined()
})

test('running until 파싱, analysis 는 추가 텍스트 허용', () => {
  expect(
    parseAutofixState([
      c('autofix:running run=a1 until=2026-11-21T02:00:00Z', '2026-11-21T01:00:00Z'),
    ])
  ).toMatchObject({ kind: 'running', until: '2026-11-21T02:00:00Z' })
  expect(parseAutofixState([c('autofix:analysis\n원인은 ...', '2026-11-21T01:00:00Z')]).kind).toBe(
    'analysis'
  )
})

test('shouldWriteNote 는 같은 상태면 false', () => {
  expect(shouldWriteNote({ kind: 'request' }, 'request')).toBe(false)
  expect(shouldWriteNote({ kind: 'skip' }, 'skip')).toBe(false)
  expect(shouldWriteNote({ kind: 'none' }, 'request')).toBe(true)
  expect(shouldWriteNote({ kind: 'failed' }, 'skip')).toBe(true)
})

describe('parseAutofixState — 리뷰 보강', () => {
  it('모르는 autofix: 노트는 이전 상태를 가리지 않는다', () => {
    expect(
      parseAutofixState([
        { text: 'autofix:skip', dateCreated: '2026-11-20T00:00:00Z' },
        { text: 'autofix:requst', dateCreated: '2026-11-21T00:00:00Z' },
      ]).kind
    ).toBe('skip')
  })
  it('PR 주소는 PR 경로 전체만, 첫 토큰만 받는다', () => {
    const ok = 'https://github.com/kaleos-platform/workdeck-app/pull/1601'
    expect(
      parseAutofixState([{ text: `autofix:pr ${ok} 추가`, dateCreated: '2026-11-21T00:00:00Z' }])
        .prUrl
    ).toBe(ok)
    expect(
      parseAutofixState([
        {
          text: 'autofix:pr https://github.com/kaleos-platform/x',
          dateCreated: '2026-11-21T00:00:00Z',
        },
      ]).prUrl
    ).toBeUndefined()
  })
})

const ID = '20261125-070000-ab12-APP-1'
const SHA = '0123456789abcdef'
const READY = `autofix:ready id=${ID} sha=${SHA} files=2 lines=14 verify=ok review=approve`

test('ready · approve 파싱, id·sha 가 틀리면 무시하고 이전 노트로 돌아간다', () => {
  expect(parseAutofixState([c(READY, '2026-11-25T01:00:00Z')])).toEqual({
    kind: 'ready',
    at: '2026-11-25T01:00:00Z',
    id: ID,
    sha: SHA,
    files: 2,
    lines: 14,
    verify: 'ok',
    review: 'approve',
  })
  expect(
    parseAutofixState([c(`autofix:approve id=${ID} sha=${SHA} by=slack`, '2026-11-25T02:00:00Z')])
  ).toMatchObject({ kind: 'approve', id: ID, sha: SHA, by: 'slack' })
  const s = parseAutofixState([
    c('autofix:request', '2026-11-25T00:00:00Z'),
    c(
      `autofix:ready id=bad sha=${SHA} files=1 lines=1 verify=ok review=approve`,
      '2026-11-25T01:00:00Z'
    ),
    c(`autofix:approve id=${ID} sha=XYZ by=admin`, '2026-11-25T02:00:00Z'),
  ])
  expect(s.kind).toBe('request')
})

test('canApprove 는 최신 ready 의 id·sha 일치만 허용', () => {
  const s = parseAutofixState([c(READY, '2026-11-25T01:00:00Z')])
  expect(canApprove(s, ID, SHA)).toBe(true)
  expect(canApprove(s, ID, 'fedcba9876543210')).toBe(false)
  expect(canApprove({ kind: 'request' }, ID, SHA)).toBe(false)
})

test('canApprove 는 검증 실패·리뷰 차단 ready 를 거부', () => {
  const bad = (t: string) => parseAutofixState([c(t, '2026-11-25T01:00:00Z')])
  expect(canApprove(bad(READY.replace('verify=ok', 'verify=fail')), ID, SHA)).toBe(false)
  expect(canApprove(bad(READY.replace('review=approve', 'review=blocking')), ID, SHA)).toBe(false)
})

test('parseTriage 는 고정 코드만 받고 최신을 쓴다, 상태에는 영향 없음', () => {
  const t = parseTriage([
    c('autofix:triage p=P2 cat=degraded act=confirm', '2026-11-25T01:00:00Z'),
    c('autofix:triage p=P1 cat=data-loss act=fix', '2026-11-25T02:00:00Z'),
    c('autofix:triage p=P9 cat=data-loss act=fix', '2026-11-25T03:00:00Z'),
    c('autofix:triage p=P1 cat=data-loss act=fix extra', '2026-11-25T04:00:00Z'),
  ])
  expect(t).toEqual({ p: 'P1', cat: 'data-loss', act: 'fix', at: '2026-11-25T02:00:00Z' })
  expect(parseTriage([])).toBeNull()
  expect(
    parseAutofixState([c('autofix:triage p=P1 cat=data-loss act=fix', '2026-11-25T02:00:00Z')]).kind
  ).toBe('none')
})

test('deriveStage', () => {
  const t = (act: 'fix' | 'confirm' | 'ignore') =>
    ({ p: 'P1', cat: 'noise', act, at: 'x' }) as const
  expect(deriveStage({ kind: 'none' }, null)).toBe('unjudged')
  expect(deriveStage({ kind: 'none' }, t('fix'))).toBe('fix-planned')
  expect(deriveStage({ kind: 'none' }, t('confirm'))).toBe('confirm')
  expect(deriveStage({ kind: 'none' }, t('ignore'))).toBe('ignore-suggested')
  expect(deriveStage({ kind: 'ready' }, t('fix'))).toBe('approval')
  expect(deriveStage({ kind: 'approve' }, null)).toBe('approved')
  expect(deriveStage({ kind: 'skip' }, t('fix'))).toBe('skipped')
  expect(deriveStage({ kind: 'pr' }, null)).toBe('pr')
})

test('triageReason 은 코드와 수치로만 만든다', () => {
  const now = Date.parse('2026-11-25T00:00:00Z')
  const t = { p: 'P1', cat: 'data-loss', act: 'fix', at: 'x' } as const
  expect(triageReason(t, { count: 48, userCount: 3, firstSeen: '2026-11-22T12:00:00Z' }, now)).toBe(
    '데이터 누락 · 3일간 48회 · 사용자 3명'
  )
  expect(triageReason(t, { count: 2, userCount: 0, firstSeen: '2026-11-25T00:00:00Z' }, now)).toBe(
    '데이터 누락 · 1일간 2회'
  )
})

describe('분석 요청 노트', () => {
  const N = '20261127-010203-0a1b2c3d'
  const REQ = `autofix:analyze-request id=${N} by=admin sig=${'a'.repeat(32)}`
  const DONE = `autofix:analyzed id=${N} verdict=fix conf=mid auto=yes issue=42 sig=${'b'.repeat(32)}`
  const ING = `autofix:analyzing id=${N} until=2026-11-27T02:00:00Z`

  test('요청·분석 중·완료·실패 파싱과 stage', () => {
    expect(parseAutofixState([c(REQ, '2026-11-27T01:00:00Z')])).toMatchObject({
      kind: 'analyze-request',
      id: N,
      by: 'admin',
    })
    expect(
      parseAutofixState([c(REQ, '2026-11-27T01:00:00Z'), c(ING, '2026-11-27T01:10:00Z')])
    ).toMatchObject({
      kind: 'analyzing',
      until: '2026-11-27T02:00:00Z',
    })
    const done = parseAutofixState([
      c(REQ, '2026-11-27T01:00:00Z'),
      c(DONE, '2026-11-27T01:30:00Z'),
    ])
    expect(done).toMatchObject({
      kind: 'analyzed',
      verdict: 'fix',
      conf: 'mid',
      auto: 'yes',
      issueNumber: 42,
    })
    expect(deriveStage(done, null)).toBe('analyzed')
    expect(deriveStage({ kind: 'analyze-request' }, null)).toBe('analyze-requested')
    expect(deriveStage({ kind: 'analyzing' }, null)).toBe('analyzing')
    const failed = parseAutofixState([c('autofix:analyze-failed gate-pii', '2026-11-27T01:00:00Z')])
    expect(failed).toMatchObject({ kind: 'analyze-failed', reason: 'gate-pii' })
    expect(deriveStage(failed, null)).toBe('analyze-failed')
  })

  test('analyzed 는 직전 요청의 nonce 와 같을 때만 인정, 아니면 무시', () => {
    const OLD = '20261126-010203-ffffffff'
    const mismatch = parseAutofixState([
      c(REQ, '2026-11-27T01:00:00Z'),
      c(DONE.replace(N, OLD), '2026-11-27T01:30:00Z'),
    ])
    expect(mismatch.kind).toBe('analyze-request')
    expect(parseAutofixState([c(DONE, '2026-11-27T01:30:00Z')]).kind).toBe('none')
    // 새 요청이 analyzed 이후에 오면 최신은 새 요청
    expect(
      parseAutofixState([
        c(REQ, '2026-11-27T01:00:00Z'),
        c(DONE, '2026-11-27T01:30:00Z'),
        c(REQ.replace(N, OLD), '2026-11-27T02:00:00Z'),
      ]).kind
    ).toBe('analyze-request')
  })

  test('형식이 틀린 메모는 없는 것으로 본다 (issue 비숫자·잘못된 nonce)', () => {
    const bad = [
      DONE.replace('issue=42', 'issue=https://evil.example'),
      DONE.replace('issue=42', 'issue=12345678'),
      DONE.replace('verdict=fix', 'verdict=boom'),
      REQ.replace('by=admin', 'by=eve'),
      REQ.replace(N, 'abc'),
      'autofix:analyze-failed Bad Code',
      'autofix:analyzing id=x until=y',
    ]
    for (const t of bad) {
      expect(
        parseAutofixState([c(REQ, '2026-11-27T01:00:00Z'), c(t, '2026-11-27T02:00:00Z')]).kind
      ).toBe('analyze-request')
    }
  })

  test('shouldWriteNote(analyze-request): 요청됨·분석 중이면 생략, 만료되면 허용', () => {
    const now = Date.parse('2026-11-27T03:00:00Z')
    expect(shouldWriteNote({ kind: 'none' }, 'analyze-request', now)).toBe(true)
    expect(shouldWriteNote({ kind: 'analyze-request' }, 'analyze-request', now)).toBe(false)
    expect(
      shouldWriteNote({ kind: 'analyzing', until: '2026-11-27T04:00:00Z' }, 'analyze-request', now)
    ).toBe(false)
    expect(
      shouldWriteNote({ kind: 'analyzing', until: '2026-11-27T02:00:00Z' }, 'analyze-request', now)
    ).toBe(true)
    expect(shouldWriteNote({ kind: 'analyze-failed' }, 'analyze-request', now)).toBe(true)
  })

  test('기존 analysis 는 그대로 분석만', () => {
    expect(
      deriveStage(parseAutofixState([c('autofix:analysis', '2026-11-27T01:00:00Z')]), null)
    ).toBe('analysis')
  })
})

test('분석 요청은 수정안 승인 흐름(ready·approve·진행 중 running)을 덮지 않는다', () => {
  const now = Date.parse('2026-11-27T00:00:00Z')
  expect(shouldWriteNote({ kind: 'ready' }, 'analyze-request', now)).toBe(false)
  expect(shouldWriteNote({ kind: 'approve' }, 'analyze-request', now)).toBe(false)
  expect(
    shouldWriteNote({ kind: 'running', until: '2026-11-27T01:00:00Z' }, 'analyze-request', now)
  ).toBe(false)
  expect(
    shouldWriteNote({ kind: 'running', until: '2026-11-26T23:00:00Z' }, 'analyze-request', now)
  ).toBe(true)
})
