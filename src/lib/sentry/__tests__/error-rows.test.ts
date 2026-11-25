/**
 * @jest-environment node
 */
const listIssues = jest.fn()
const listComments = jest.fn()
jest.mock('server-only', () => ({}))
jest.mock('@/lib/sentry/api', () => ({
  listIssues: (...a: unknown[]) => listIssues(...a),
  listComments: (...a: unknown[]) => listComments(...a),
}))

import { buildErrorRows } from '../error-rows'

const ID = '20261125-043000-ab12-WEB-1A'
const SHA = '0123456789abcdef'
const issue = (id: string, over = {}) => ({
  id,
  shortId: id,
  title: id,
  culprit: '',
  permalink: '',
  count: 1,
  userCount: 1,
  firstSeen: '',
  lastSeen: '',
  numComments: 0,
  service: 'web',
  ...over,
})

it('승인 대기 행이 우선순위보다 먼저 오고 limit 로 자르지 않을 수 있다', async () => {
  const p1 = Array.from({ length: 30 }, (_, i) => issue(`p${i}`, { numComments: 1, userCount: 9 }))
  const ap = issue('ap', { numComments: 1, userCount: 0 })
  listIssues.mockImplementation(async (s: string) => (s === 'web' ? [...p1, ap] : []))
  listComments.mockImplementation(async (id: string) =>
    id === 'ap'
      ? [
          {
            text: `autofix:ready id=${ID} sha=${SHA} files=1 lines=1 verify=ok review=approve`,
            dateCreated: '2026-11-25T01:00:00Z',
          },
        ]
      : [{ text: 'autofix:triage p=P1 cat=data-loss act=fix', dateCreated: '2026-11-25T01:00:00Z' }]
  )
  const limited = await buildErrorRows('all')
  expect(limited.rows).toHaveLength(25)
  expect(limited.rows[0].id).toBe('ap')
  expect((await buildErrorRows('all', Infinity)).rows).toHaveLength(31)
})
