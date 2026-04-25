// notifications.ts — formatNoticeText 순수 함수 + notifyJobFailure 의 webhook 미설정 noop 검증.
// 실제 webhook fetch 는 프로세스 env + 외부 호출이라 여기서는 모킹으로 호출 여부만 확인.

import { formatNoticeText, notifyJobFailure, redactErrorMessage } from '../notifications'

const baseNotice = {
  jobId: 'job-1',
  jobKind: 'PUBLISH',
  errorCode: 'AUTH_FAILED',
  errorMessage: '네이버 세션이 만료됐습니다.',
  targetId: 'd1',
  spaceId: 'space-1',
}

describe('formatNoticeText', () => {
  it('알림 텍스트에 핵심 필드가 포함된다', () => {
    const t = formatNoticeText(baseNotice)
    expect(t).toContain('PUBLISH')
    expect(t).toContain('AUTH_FAILED')
    expect(t).toContain('job-1')
    expect(t).toContain('d1')
    expect(t).toContain('space-1')
    expect(t).toContain('네이버 세션이 만료됐습니다.')
  })

  it('errorCode 가 없으면 UNKNOWN 으로 표기', () => {
    const t = formatNoticeText({ ...baseNotice, errorCode: null })
    expect(t).toContain('UNKNOWN')
  })

  it('errorMessage 는 400자로 잘림', () => {
    const long = 'X'.repeat(1000)
    const t = formatNoticeText({ ...baseNotice, errorMessage: long })
    // 본문 라인에 잘린 X 포함, 전체 길이는 400자 + 헤더만
    expect(t.length).toBeLessThan(700)
    expect(t).toContain('XXX')
  })

  it('targetId 가 없으면 target= 부분 생략', () => {
    const t = formatNoticeText({ ...baseNotice, targetId: null })
    expect(t).not.toMatch(/target=/)
  })

  it('errorMessage 의 자격증명 패턴은 redaction 적용', () => {
    const t = formatNoticeText({
      ...baseNotice,
      errorMessage: 'fetch failed: Bearer abcd1234efgh5678 expired',
    })
    expect(t).not.toContain('abcd1234efgh5678')
    expect(t).toContain('[REDACTED]')
  })
})

describe('redactErrorMessage', () => {
  it('Bearer 토큰을 가린다', () => {
    expect(redactErrorMessage('Authorization: Bearer abcd1234efgh5678ijklm')).toBe(
      'Authorization: Bearer [REDACTED]'
    )
  })

  it('api_key=... 같은 자격증명 키를 가린다', () => {
    expect(redactErrorMessage('?api_key=secret123abc&foo=bar')).toContain('api_key=[REDACTED]')
  })

  it('JWT 형태의 토큰을 가린다', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    expect(redactErrorMessage(`token=${jwt} expired`)).toContain('[REDACTED_JWT]')
    expect(redactErrorMessage(`token=${jwt} expired`)).not.toContain(jwt)
  })

  it('일반 텍스트는 그대로 둔다', () => {
    expect(redactErrorMessage('네이버 세션이 만료됐습니다.')).toBe('네이버 세션이 만료됐습니다.')
  })
})

describe('notifyJobFailure', () => {
  const originalEnv = process.env.SC_FAILURE_WEBHOOK_URL
  const originalFetch = global.fetch

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SC_FAILURE_WEBHOOK_URL
    else process.env.SC_FAILURE_WEBHOOK_URL = originalEnv
    global.fetch = originalFetch
  })

  it('SC_FAILURE_WEBHOOK_URL 미설정 시 fetch 호출 없음', async () => {
    delete process.env.SC_FAILURE_WEBHOOK_URL
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await notifyJobFailure(baseNotice)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('webhook URL 설정 시 fetch 1회 호출', async () => {
    process.env.SC_FAILURE_WEBHOOK_URL = 'https://hooks.slack.test/xxx'
    const fetchMock = jest.fn().mockResolvedValue({ ok: true })
    global.fetch = fetchMock as unknown as typeof fetch

    await notifyJobFailure(baseNotice)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://hooks.slack.test/xxx')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(((init as RequestInit).body as string) ?? '{}')
    expect(body.text).toContain('AUTH_FAILED')
  })

  it('fetch 실패해도 throw 하지 않음', async () => {
    process.env.SC_FAILURE_WEBHOOK_URL = 'https://hooks.slack.test/xxx'
    global.fetch = jest.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch

    await expect(notifyJobFailure(baseNotice)).resolves.toBeUndefined()
  })
})
