// SC job 실패 알림 — Slack-compatible webhook 으로 fire-and-forget 전송.
// `SC_FAILURE_WEBHOOK_URL` 미설정 시 noop. 호출 측은 알림 결과를 기다리지 않는다.

const TIMEOUT_MS = 3000

// errorMessage 가 외부 webhook(Slack 등) 으로 나가기 전에 자격증명/토큰을 가린다.
// Publisher/Collector 가 SDK 에러 메시지를 그대로 전달할 때 키·세션쿠키가 섞이는 케이스 방지.
const REDACTORS: Array<{ pattern: RegExp; replace: string }> = [
  // Authorization: Bearer xxxxx, Bearer xxx, Token xxx
  { pattern: /\b(Bearer|Token)\s+[A-Za-z0-9._\-+/=]{8,}/gi, replace: '$1 [REDACTED]' },
  // ?key=, &token=, "secret":"..." 등 흔한 자격증명 키
  {
    pattern:
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|cookie|session)\s*[=:]\s*"?[A-Za-z0-9._\-+/=]{4,}"?/gi,
    replace: '$1=[REDACTED]',
  },
  // JWT (3 segments base64 separated by dots) — 16자 이상 짧은 비밀번호 hash 와 구별.
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: '[REDACTED_JWT]',
  },
]

export function redactErrorMessage(input: string): string {
  let out = input
  for (const { pattern, replace } of REDACTORS) {
    out = out.replace(pattern, replace)
  }
  return out
}

export type JobFailureNotice = {
  jobId: string
  jobKind: string
  errorCode: string | null | undefined
  errorMessage: string
  targetId: string | null
  spaceId: string
}

/**
 * Slack incoming webhook 또는 동등한 JSON {text} 수신 엔드포인트로 실패 알림 전송.
 * non-retryable 실패(자격증명 만료 등)에서 운영자가 즉시 인지하도록 사용한다.
 * 네트워크/형식 오류는 모두 swallow — 알림 실패가 본 흐름을 막지 않는다.
 */
export async function notifyJobFailure(notice: JobFailureNotice): Promise<void> {
  const url = process.env.SC_FAILURE_WEBHOOK_URL
  if (!url) return

  const text = formatNoticeText(notice)
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))
  } catch {
    // 알림 실패는 의도적으로 swallow. 운영 측에서 대시보드/SQL 로 fallback 모니터링.
  }
}

export function formatNoticeText(notice: JobFailureNotice): string {
  const code = notice.errorCode ?? 'UNKNOWN'
  const target = notice.targetId ? ` target=${notice.targetId}` : ''
  // Slack 은 일부 마크다운만 지원 — 단순 텍스트 + 백틱 사용.
  // errorMessage 는 외부 webhook 노출 전에 자격증명 패턴 redaction.
  const safe = redactErrorMessage(notice.errorMessage).slice(0, 400)
  return [
    `🚨 sales-content job 실패`,
    `\`kind=${notice.jobKind}\` \`code=${code}\` jobId=${notice.jobId}${target}`,
    `space=${notice.spaceId}`,
    `> ${safe}`,
  ].join('\n')
}
