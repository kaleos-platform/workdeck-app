/**
 * @jest-environment node
 */
jest.mock('server-only', () => ({}))

import { noteSig } from '../autofix-sig'
import { listComments } from '../api'

const ID = '20261125-043000-ab12-WEB-1A'
const SHA = '0123456789abcdef'
const KEY = 'k'.repeat(40)
const mockFetch = jest.fn()
const mk = (text: string) => ({ data: { text }, dateCreated: '2026-11-25T00:00:00Z' })
const ready = (sig: string) =>
  `autofix:ready id=${ID} sha=${SHA} files=1 lines=2 verify=ok review=approve${sig}`

beforeEach(() => {
  process.env.SENTRY_AUTOFIX_NOTE_SECRET = KEY
  global.fetch = mockFetch as unknown as typeof fetch
})

function serve(texts: string[]) {
  mockFetch.mockResolvedValue({ ok: true, json: async () => texts.map(mk) })
  return listComments('99').then((r) => r.map((c) => c.text))
}

describe('listComments 서명 검증', () => {
  it('올바른 서명의 ready·approve 는 유지, 다른 노트는 그대로', async () => {
    const r = ready(` sig=${noteSig('ready', '99', ID, SHA)}`)
    const a = `autofix:approve id=${ID} sha=${SHA} by=admin sig=${noteSig('approve', '99', ID, SHA)}`
    expect(await serve([r, a, 'autofix:request', '메모'])).toEqual([
      r,
      a,
      'autofix:request',
      '메모',
    ])
  })

  it('틀린·없는·다른 이슈용 서명은 버린다', async () => {
    const other = ready(` sig=${noteSig('ready', '100', ID, SHA)}`)
    const wrongKind = `autofix:approve id=${ID} sha=${SHA} by=admin sig=${noteSig('ready', '99', ID, SHA)}`
    expect(
      await serve([
        ready(` sig=${'0'.repeat(32)}`),
        ready(''),
        ready(' sig=short'),
        other,
        wrongKind,
        'autofix:skip',
      ])
    ).toEqual(['autofix:skip'])
  })

  it('키가 없으면 ready·approve 모두 버린다', async () => {
    const r = ready(` sig=${noteSig('ready', '99', ID, SHA)}`)
    delete process.env.SENTRY_AUTOFIX_NOTE_SECRET
    expect(await serve([r, 'autofix:request'])).toEqual(['autofix:request'])
  })

  it('32자 미만 키는 없는 것으로 본다', async () => {
    const r = ready(` sig=${noteSig('ready', '99', ID, SHA)}`)
    process.env.SENTRY_AUTOFIX_NOTE_SECRET = 'short'
    expect(await serve([r])).toEqual([])
  })
})

describe('분석 노트 서명 검증', () => {
  const N = '20261127-010203-0a1b2c3d'
  const sha16 = 'b0c208ff7cedfa83'
  const req = (sig: string) => `autofix:analyze-request id=${N} by=admin sig=${sig}`
  const done = (sig: string) =>
    `autofix:analyzed id=${N} verdict=fix conf=mid auto=yes issue=42 sig=${sig}`

  it('공통 시험 벡터 (러너와 동일 값)', () => {
    process.env.SENTRY_AUTOFIX_NOTE_SECRET = 's'.repeat(32)
    expect(noteSig('analyze-request', '123', N, '0000000000000000')).toBe(
      '155d3594dcb210d2680723039428b67f'
    )
    expect(noteSig('analyzed', '123', N, sha16)).toBe('d4bf32eff2a54bcd4dea39f26de7ffbc')
  })

  it('서명이 맞는 analyze-request·analyzed 만 유지 (analyzing·analyze-failed 는 서명 없이 통과)', async () => {
    process.env.SENTRY_AUTOFIX_NOTE_SECRET = 's'.repeat(32)
    const ok = [req('155d3594dcb210d2680723039428b67f'), done('d4bf32eff2a54bcd4dea39f26de7ffbc')]
    const ing = `autofix:analyzing id=${N} until=2026-11-27T02:00:00Z`
    const failed = 'autofix:analyze-failed gate'
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [...ok, ing, failed].map((t) => ({ data: { text: t }, dateCreated: 'x' })),
    })
    const r = (await listComments('123')).map((c) => c.text)
    expect(r).toEqual([...ok, ing, failed])
  })

  it('틀린 서명·내용 변조(판정 바꿈)·다른 이슈는 버린다', async () => {
    process.env.SENTRY_AUTOFIX_NOTE_SECRET = 's'.repeat(32)
    const sigDone = 'd4bf32eff2a54bcd4dea39f26de7ffbc'
    expect(
      await serveFor('123', [
        req('0'.repeat(32)),
        req(''),
        done(sigDone).replace('verdict=fix', 'verdict=ignore'),
        done(sigDone).replace('issue=42', 'issue=43'),
        req('155d3594dcb210d2680723039428b67f') + 'x',
      ])
    ).toEqual([])
    expect(await serveFor('124', [req('155d3594dcb210d2680723039428b67f')])).toEqual([])
  })
})

function serveFor(issueId: string, texts: string[]) {
  mockFetch.mockResolvedValue({ ok: true, json: async () => texts.map(mk) })
  return listComments(issueId).then((r) => r.map((c) => c.text))
}
