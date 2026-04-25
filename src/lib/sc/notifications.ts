// SC job 실패 알림 — Slack-compatible webhook 으로 fire-and-forget 전송.
// `SC_FAILURE_WEBHOOK_URL` 미설정 시 noop. 호출 측은 알림 결과를 기다리지 않는다.

const TIMEOUT_MS = 3000

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
  return [
    `🚨 sales-content job 실패`,
    `\`kind=${notice.jobKind}\` \`code=${code}\` jobId=${notice.jobId}${target}`,
    `space=${notice.spaceId}`,
    `> ${notice.errorMessage.slice(0, 400)}`,
  ].join('\n')
}
