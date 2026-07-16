/**
 * Slack Web API raw fetch 래퍼 — @slack/* 패키지를 쓰지 않는다.
 * 모든 호출에 AbortController 타임아웃(기본 5초)을 걸어, Slack이 응답을 지연시켜도
 * 호출자(알림·동기화)가 무한정 매달리지 않게 한다.
 */
const SLACK_API_BASE = 'https://slack.com/api'
const DEFAULT_TIMEOUT_MS = 5000

export interface SlackApiResponse {
  ok: boolean
  error?: string
  [key: string]: unknown
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** JSON body로 Slack Web API 메서드를 호출한다(bot 토큰 Bearer 인증). */
export async function slackApi(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<SlackApiResponse> {
  const res = await fetchWithTimeout(`${SLACK_API_BASE}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  return (await res.json()) as SlackApiResponse
}

/** chat.postMessage — 성공 시 { ok, ts, channel } 반환. thread_ts 지정 시 스레드 답글. */
export async function postMessage(
  token: string,
  args: { channel: string; text: string; blocks?: unknown[]; thread_ts?: string }
): Promise<SlackApiResponse> {
  return slackApi(token, 'chat.postMessage', args)
}

/** chat.update — 기존 메시지를 갱신(버튼 제거·상태 문구 등). */
export async function chatUpdate(
  token: string,
  args: { channel: string; ts: string; text: string; blocks?: unknown[] }
): Promise<SlackApiResponse> {
  return slackApi(token, 'chat.update', args)
}

/**
 * response_url로 ephemeral 응답을 보낸다(interactive 콜백 전용, 토큰 불필요).
 * 3초 인터랙션 데드라인을 넘기지 않도록 client.ts 공용 타임아웃을 적용한다.
 */
export async function postResponseUrl(
  responseUrl: string,
  body: Record<string, unknown>
): Promise<void> {
  await fetchWithTimeout(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * oauth.v2.access — install code를 bot 토큰으로 교환한다.
 * client_id/client_secret은 form-encoded로 보낸다(Slack 요구사항).
 */
export async function oauthV2Access(code: string, redirectUri: string): Promise<SlackApiResponse> {
  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'slack_client_env_missing' }
  }

  const form = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  })

  const res = await fetchWithTimeout(`${SLACK_API_BASE}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  return (await res.json()) as SlackApiResponse
}
