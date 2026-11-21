/** @jest-environment node */
import { buildReportText } from '../platform-funnel-report'

jest.mock('server-only', () => ({}))
jest.mock('@/lib/admin/platform-google', () => ({ readPlatformGoogle: jest.fn() }))
jest.mock('@/lib/slack/send-notification', () => ({ sendSystemNotification: jest.fn() }))

describe('buildReportText', () => {
  it('방문자가 정하는 source·medium 의 Slack 제어 구문을 escape 한다', () => {
    const text = buildReportText({
      measurementId: 'G-5F8G9Y4VHW',
      enhanced: null,
      errors: [],
      funnel: {
        days: 7,
        events: {
          page_view: 10,
          cta_click: 3,
          generate_lead: 1,
          sign_up: 2,
          trial_start: 1,
          subscribe: 0,
        },
        sources: [
          {
            source: '<!channel>',
            medium: '<https://evil.example|재인증>',
            signUp: 1,
            subscribe: 0,
          },
        ],
      },
    })
    expect(text).not.toContain('<!channel>')
    expect(text).not.toContain('<https://')
    expect(text).toContain('&lt;!channel&gt; / &lt;https://evil.example|재인증&gt;')
  })
})
