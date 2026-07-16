/**
 * POST /api/slack/events
 * Slack Events API 엔드포인트. M3는 url_verification 핸드셰이크만 처리하고
 * 나머지 이벤트는 200으로 무시한다(실제 이벤트 처리는 M4 예약).
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifySlackSignature } from '@/lib/slack/verify'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // 서명은 raw body 바이트 위에서 검증해야 하므로 먼저 text로 읽는다.
  const rawBody = await req.text()
  const ok = verifySlackSignature({
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    timestamp: req.headers.get('x-slack-request-timestamp'),
    rawBody,
    signature: req.headers.get('x-slack-signature'),
  })
  if (!ok) return NextResponse.json({ message: '서명 검증 실패' }, { status: 401 })

  let payload: { type?: string; challenge?: string }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ message: '잘못된 요청 본문' }, { status: 400 })
  }

  // Events API 등록 시 1회 핸드셰이크.
  if (payload.type === 'url_verification') {
    return NextResponse.json({ challenge: payload.challenge })
  }

  // M4 예약 — 그 외 이벤트는 즉시 200으로 수신 확인만 한다.
  return NextResponse.json({ ok: true })
}
