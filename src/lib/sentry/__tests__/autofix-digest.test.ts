/**
 * @jest-environment node
 */
import type { ErrorRow } from '@/components/admin/errors-table'

const buildErrorRows = jest.fn()
const sendSystemNotification = jest.fn()
const isSentryApiConfigured = jest.fn()

jest.mock('@/lib/sentry/error-rows', () => ({
  buildErrorRows: (...a: unknown[]) => buildErrorRows(...a),
}))
jest.mock('@/lib/sentry/api', () => ({ isSentryApiConfigured: () => isSentryApiConfigured() }))
jest.mock('@/lib/slack/send-notification', () => ({
  OPS_SPACE_ID: 'ops',
  sendSystemNotification: (...a: unknown[]) => sendSystemNotification(...a),
}))

import { buildDigestMessage, runSentryAutofixDigest } from '../autofix-digest'

const ID = '20261125-043000-ab12-WEB-1A'
const SHA = '0123456789abcdef'
const base = {
  id: '99',
  shortId: 'WEB-1A',
  title: 't',
  culprit: '',
  permalink: '',
  count: 5,
  userCount: 2,
  firstSeen: new Date().toISOString(),
} as unknown as ErrorRow

const approval = (over: Partial<ErrorRow> = {}): ErrorRow => ({
  ...base,
  stage: 'approval',
  triage: { p: 'P1', cat: 'data-loss', act: 'fix', at: '' },
  autofix: {
    kind: 'ready',
    id: ID,
    sha: SHA,
    files: 2,
    lines: 35,
    verify: 'ok',
    review: 'approve',
  },
  ...over,
})
const confirm = (over: Partial<ErrorRow> = {}): ErrorRow => ({
  ...base,
  id: '100',
  stage: 'confirm',
  triage: { p: 'P2', cat: 'degraded', act: 'confirm', at: '' },
  autofix: { kind: 'none' },
  ...over,
})

describe('buildDigestMessage', () => {
  it('보고할 것이 없으면 null', () => {
    expect(
      buildDigestMessage([{ ...base, stage: 'unjudged', triage: null, autofix: { kind: 'none' } }])
    ).toBeNull()
  })

  it('승인 대기 행: 헤더·본문·버튼 value 형식', () => {
    const msg = buildDigestMessage([approval(), confirm()])!
    expect(msg.text).toBe('Sentry 오류 판단 — P1 1 · P2 1 · P3 0 · 판단 전 0')
    const json = JSON.stringify(msg.blocks)
    expect(json).toContain('*승인 대기* WEB-1A')
    expect(json).toContain('변경 2개 파일/35줄 · 검증 통과 · 리뷰 approve')
    expect(json).toContain('*확인 필요*')
    const buttons = (msg.blocks as { type: string; elements?: Record<string, unknown>[] }[]).find(
      (b) => b.type === 'actions'
    )!.elements!
    expect(buttons[0]).toMatchObject({
      style: 'primary',
      action_id: 'sentry_autofix_approve',
      value: `99|${ID}|${SHA}`,
    })
    expect(buttons[1]).toMatchObject({
      action_id: 'sentry_autofix_open',
      url: 'https://admin.workdeck.work/admin/errors?stage=approval',
    })
  })

  it('Sentry 제목은 이스케이프·절단된다', () => {
    const msg = buildDigestMessage([
      approval({ title: '<@U123> *bold* <https://x|y> ' + 'a'.repeat(200), shortId: '<!channel>' }),
    ])!
    const json = JSON.stringify(msg.blocks)
    expect(json).not.toContain('<@U123>')
    expect(json).not.toContain('<https://x|y>')
    expect(json).not.toContain('<!channel>')
    expect(json).toContain('&lt;@U123&gt;')
    expect(json).not.toContain('a'.repeat(100))
  })

  it('승인 대기·확인 필요는 각각 최대 5건', () => {
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => approval({ id: String(i), shortId: `A${i}` })),
      ...Array.from({ length: 7 }, (_, i) => confirm({ id: `c${i}`, shortId: `C${i}` })),
    ]
    const json = JSON.stringify(buildDigestMessage(rows)!.blocks)
    expect(json.match(/승인 대기\*/g)).toHaveLength(5)
    expect(json.match(/확인 필요\*/g)).toHaveLength(5)
  })
})

describe('runSentryAutofixDigest', () => {
  beforeEach(() => jest.clearAllMocks())

  it('Sentry 미설정이면 skipped', async () => {
    isSentryApiConfigured.mockReturnValue(false)
    expect(await runSentryAutofixDigest()).toEqual({ skipped: true })
    expect(buildErrorRows).not.toHaveBeenCalled()
  })

  it('보낼 것이 없으면 발송 없이 skipped', async () => {
    isSentryApiConfigured.mockReturnValue(true)
    buildErrorRows.mockResolvedValue({ rows: [] })
    expect(await runSentryAutofixDigest()).toEqual({ skipped: true })
    expect(sendSystemNotification).not.toHaveBeenCalled()
  })

  it('운영 Space 로 발송하고 결과를 반환', async () => {
    isSentryApiConfigured.mockReturnValue(true)
    buildErrorRows.mockResolvedValue({ rows: [approval()] })
    sendSystemNotification.mockResolvedValue(true)
    expect(await runSentryAutofixDigest()).toEqual({ sent: true })
    expect(sendSystemNotification).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'ops' }))
  })
})
