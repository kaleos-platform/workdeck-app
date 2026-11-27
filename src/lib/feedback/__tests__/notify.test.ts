/** @jest-environment node */
const input = {
  id: 'fb1',
  type: 'BUG' as const,
  userEmail: 'u@x.com',
  spaceName: '공간',
  pagePath: '/dashboard',
  body: '본문',
  attachmentCount: 1,
  capReached: false,
}
const load = async () => {
  jest.resetModules()
  return (await import('../notify')).notifyFeedbackSlack
}
const sent = (f: jest.Mock) => JSON.parse(f.mock.calls[0][1].body).text as string
let fetchMock: jest.Mock
beforeEach(() => {
  fetchMock = jest.fn(async () => ({ ok: true }))
  global.fetch = fetchMock as never
  delete process.env.FEEDBACK_SLACK_WEBHOOK_URL
  delete process.env.LEAD_SLACK_WEBHOOK_URL
})

it('전용 webhook 우선, 없으면 LEAD, 둘 다 없으면 미호출', async () => {
  const n = await load()
  await n(input)
  expect(fetchMock).not.toHaveBeenCalled()
  process.env.LEAD_SLACK_WEBHOOK_URL = 'https://lead'
  await n(input)
  expect(fetchMock.mock.calls[0][0]).toBe('https://lead')
  process.env.FEEDBACK_SLACK_WEBHOOK_URL = 'https://fb'
  await n(input)
  expect(fetchMock.mock.calls[1][0]).toBe('https://fb')
})
it('본문 300자 절단·escape·링크·상한 문구', async () => {
  process.env.FEEDBACK_SLACK_WEBHOOK_URL = 'https://fb'
  const n = await load()
  await n({ ...input, body: 'a'.repeat(301) })
  expect(sent(fetchMock)).toContain('a'.repeat(300) + '…')
  expect(sent(fetchMock)).not.toContain('a'.repeat(301))
  expect(sent(fetchMock)).toContain('/admin/feedback/fb1')
  fetchMock.mockClear()
  await n({ ...input, body: '<b>&', capReached: true })
  expect(sent(fetchMock)).toContain('&lt;b&gt;&amp;')
  expect(sent(fetchMock)).toContain('첨부 용량 상한 도달')
})
it('fetch reject여도 resolve', async () => {
  process.env.FEEDBACK_SLACK_WEBHOOK_URL = 'https://fb'
  fetchMock.mockRejectedValue(new Error('net'))
  await expect((await load())(input)).resolves.toBeUndefined()
})
