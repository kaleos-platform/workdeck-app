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
