/** @jest-environment node */
import { notifyAnalysisDone } from '../slack-notifier.js'

jest.mock('../api-client.js', () => ({
  getSlackNotificationTarget: jest.fn(async () => ({
    notifyEnabled: true,
    target: { botToken: 't', botTokenIv: 'i', channelId: 'C1' },
  })),
}))
jest.mock('../encryption.js', () => ({ decryptSecret: () => 'xoxb-test' }))

let sent: string
const base = {
  summary: 's',
  suggestionCount: 2,
  campaignCount: 1,
  workspaceId: 'ws',
  topSuggestions: [
    { type: 'REMOVE_KEYWORD', priority: 'HIGH', target: 'kwA', reason: 'r' },
    { type: 'BID', priority: 'LOW', target: 'kwB', reason: 'r' },
  ],
}

beforeEach(() => {
  process.env.WORKDECK_APP_URL = 'http://app.test'
  sent = ''
  global.fetch = jest.fn(async (_u: unknown, init?: RequestInit) => {
    sent = String(init?.body)
    return new Response(JSON.stringify({ ok: true }))
  }) as typeof fetch
})

test('REMOVE_KEYWORD 는 제안 목록·개수에서 제외', async () => {
  await notifyAnalysisDone(base)
  expect(sent).not.toContain('kwA')
  expect(sent).toContain('kwB')
  expect(sent).toContain('*제안*\\n1개')
})

test('요약이 있으면 제외 키워드 줄 추가', async () => {
  await notifyAnalysisDone({
    ...base,
    negativeKeywordSummary: { candidateCount: 5, campaignCount: 2, spendingAfterRemovalCount: 1 },
  })
  expect(sent).toContain('제외 후보 5개(캠페인 2개) · 제거했는데 지출 중 1개')
  expect(sent).toContain('http://app.test/d/coupang-ads/negative-keywords|제외 키워드 화면')
})

test('요약 없음 또는 0건이면 줄 생략', async () => {
  await notifyAnalysisDone(base)
  expect(sent).not.toContain('제외 후보')
  await notifyAnalysisDone({
    ...base,
    negativeKeywordSummary: { candidateCount: 0, campaignCount: 0, spendingAfterRemovalCount: 0 },
  })
  expect(sent).not.toContain('제외 후보')
})
