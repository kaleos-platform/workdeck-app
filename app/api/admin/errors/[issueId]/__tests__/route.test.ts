/**
 * @jest-environment node
 */
const requireOperator = jest.fn()
const writeAuditLog = jest.fn()
const listComments = jest.fn()
const addComment = jest.fn()

jest.mock('server-only', () => ({}))
jest.mock('@/lib/admin/auth', () => ({
  requireOperator: () => requireOperator(),
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}))
jest.mock('@/lib/sentry/api', () => ({
  isSentryApiConfigured: () => true,
  listComments: (...a: unknown[]) => listComments(...a),
  addComment: (...a: unknown[]) => addComment(...a),
}))

import { noteSig } from '@/lib/sentry/autofix-sig'
import { POST } from '../route'

const N = '20261127-010203-0a1b2c3d'
const call = (body: unknown) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ issueId: '99' }),
  })

beforeEach(() => {
  jest.clearAllMocks()
  process.env.SENTRY_AUTOFIX_NOTE_SECRET = 's'.repeat(40)
  requireOperator.mockResolvedValue({ ok: true, user: { id: 'u1' } })
  listComments.mockResolvedValue([])
  addComment.mockResolvedValue(undefined)
})

describe('POST action=analyze', () => {
  it('감사 후 서명된 analyze-request 메모를 쓴다', async () => {
    const order: string[] = []
    writeAuditLog.mockImplementation(async () => void order.push('audit'))
    addComment.mockImplementation(async () => void order.push('comment'))
    const res = await call({ action: 'analyze' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(order).toEqual(['audit', 'comment'])
    const m =
      /^autofix:analyze-request id=(\d{8}-\d{6}-[0-9a-f]{8}) by=admin sig=([0-9a-f]{32})$/.exec(
        addComment.mock.calls[0][1]
      )
    expect(m).not.toBeNull()
    expect(m![2]).toBe(noteSig('analyze-request', '99', m![1], '0'.repeat(16)))
    expect(writeAuditLog).toHaveBeenCalledWith('u1', 'sentryIssue.autofix', 'sentryIssue', '99', {
      action: 'analyze',
      status: 'requested',
    })
  })

  it('이미 요청됨이면 skipped, 메모·감사 없음', async () => {
    listComments.mockResolvedValue([
      {
        text: `autofix:analyze-request id=${N} by=admin sig=${noteSig('analyze-request', '99', N, '0'.repeat(16))}`,
        dateCreated: '2026-11-27T01:00:00Z',
      },
    ])
    const res = await call({ action: 'analyze' })
    expect(await res.json()).toEqual({ ok: true, skipped: true })
    expect(addComment).not.toHaveBeenCalled()
    expect(writeAuditLog).not.toHaveBeenCalled()
  })

  it('분석 중(만료 전)이면 skipped, 만료되면 다시 요청 가능', async () => {
    const ing = (until: string) => [
      { text: `autofix:analyzing id=${N} until=${until}`, dateCreated: '2026-11-27T01:00:00Z' },
    ]
    listComments.mockResolvedValue(ing('2999-01-01T00:00:00Z'))
    expect(await (await call({ action: 'analyze' })).json()).toEqual({ ok: true, skipped: true })
    listComments.mockResolvedValue(ing('2000-01-01T00:00:00Z'))
    expect(await (await call({ action: 'analyze' })).json()).toEqual({ ok: true })
    expect(addComment).toHaveBeenCalledTimes(1)
  })

  it('서명 키가 없으면 503 이고 아무것도 쓰지 않는다', async () => {
    delete process.env.SENTRY_AUTOFIX_NOTE_SECRET
    const res = await call({ action: 'analyze' })
    expect(res.status).toBe(503)
    expect(addComment).not.toHaveBeenCalled()
    expect(writeAuditLog).not.toHaveBeenCalled()
  })

  it('메모 쓰기 실패: 502 + failed 감사', async () => {
    addComment.mockRejectedValue(new Error('boom'))
    const res = await call({ action: 'analyze' })
    expect(res.status).toBe(502)
    expect(writeAuditLog.mock.calls[1][4]).toMatchObject({ action: 'analyze', status: 'failed' })
  })

  it('기존 request 는 서명 키 없이도 동작', async () => {
    delete process.env.SENTRY_AUTOFIX_NOTE_SECRET
    expect((await call({ action: 'request' })).status).toBe(200)
    expect(addComment).toHaveBeenCalledWith('99', 'autofix:request')
  })
})
