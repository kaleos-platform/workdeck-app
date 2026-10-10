/**
 * GET /api/slack/oauth/install
 * Space ADMIN이 Slack 설치를 시작한다. 서명된 state와 함께 Slack authorize로 리다이렉트.
 */
import { NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { errorResponse, assertRole, resolveSpaceContext } from '@/lib/api-helpers'
import { buildAppUrl } from '@/lib/domain'
import { signState } from '@/lib/slack/state'

export const runtime = 'nodejs'

// manifest(docs/agent/slack-app-manifest.yml)의 bot scope와 반드시 동기 유지 —
// OAuth 설치 시 실제 부여되는 scope는 이 목록이다(manifest는 앱 설정일 뿐).
const SLACK_SCOPES = 'chat:write,channels:read,app_mentions:read,users:read,users:read.email'

export async function GET() {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)

  const ctx = await resolveSpaceContext()
  if ('error' in ctx) return ctx.error

  const roleError = assertRole(ctx.role, 'ADMIN')
  if (roleError) return roleError

  const clientId = process.env.SLACK_CLIENT_ID
  if (!clientId) {
    return errorResponse('Slack 연동이 설정되지 않았습니다(SLACK_CLIENT_ID 미설정)', 503)
  }

  const state = signState({ spaceId: ctx.space.id, userId: user.id })
  const redirectUri = buildAppUrl('/api/slack/oauth/callback')

  const authorize = new URL('https://slack.com/oauth/v2/authorize')
  authorize.searchParams.set('client_id', clientId)
  authorize.searchParams.set('scope', SLACK_SCOPES)
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('redirect_uri', redirectUri)

  return NextResponse.redirect(authorize.toString())
}
