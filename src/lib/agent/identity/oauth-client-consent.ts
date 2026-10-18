import { prisma } from '@/lib/prisma'

export const OAUTH_CONSENT_REQUIRED =
  '이 OAuth 클라이언트로 먼저 로그인해 승인한 뒤 연결하세요(본인이 승인한 클라이언트만 연결할 수 있습니다)'

/**
 * 이 사용자가 그 OAuth 클라이언트에 유효한 동의를 했는가(Supabase auth.oauth_consents, 철회 안 됨,
 * 클라이언트 삭제 안 됨). 연동 계정에 client_id 를 묶을 때 쓴다 — 남의 클라이언트를 먼저 묶어
 * 그 사용자들의 MCP 접속을 막는 선점을 막는다(본인이 그 클라이언트로 로그인·승인했어야 한다).
 */
export async function hasActiveOAuthConsent(userId: string, clientId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ ok: number }>>`
    select 1 as ok
    from auth.oauth_consents c
    join auth.oauth_clients k on k.id::text = c.client_id::text
    where c.user_id::text = ${userId}
      and c.client_id::text = ${clientId}
      and c.revoked_at is null
      and k.deleted_at is null
    limit 1`
  return rows.length > 0
}
