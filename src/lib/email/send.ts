import 'server-only'

// 공용 메일 발송 — Resend REST. RESEND_API_KEY 미설정(로컬·테스트)이면 보내지 않고 false.
// 실패는 throw 한다 — 호출 측이 사용자 흐름을 막지 않게 잡아서 로깅한다.

export type SendEmailInput = {
  from: string
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string | string[]
  /** 같은 키 재요청은 Resend 가 24시간 안에 한 번만 발송한다 */
  idempotencyKey?: string
}

const TIMEOUT_MS = 5000

export const NOREPLY_ADDRESS = 'noreply@workdeck.work'

export { escapeHtml } from './layout'

/** 발신 표시 이름 — 헤더 주입·따옴표 깨짐을 막기 위해 제어문자·따옴표·꺾쇠를 제거한다 */
export function formatFrom(displayName: string, address = NOREPLY_ADDRESS) {
  const cleaned = displayName
    .replace(/[\u0000-\u001f\u007f"\\<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // 코드포인트 단위로 잘라 서로게이트 쌍(이모지)이 깨지지 않게 한다
  const safe = Array.from(cleaned).slice(0, 80).join('').trim()
  return safe ? `"${safe}" <${address}>` : address
}

export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(input.idempotencyKey && { 'Idempotency-Key': input.idempotencyKey }),
    },
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      ...(input.text && { text: input.text }),
      ...(input.replyTo && { reply_to: input.replyTo }),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`resend ${res.status}`)
  return true
}
