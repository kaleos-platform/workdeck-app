import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * 인증 앱(TOTP)을 등록·검증한 사용자 id 집합. 조회 실패 시 null(호출측에서 「—」 표시).
 */
export async function getVerifiedTotpUserIds(userIds: string[]): Promise<Set<string> | null> {
  if (userIds.length === 0) return new Set()
  try {
    const rows = await prisma.$queryRaw<{ user_id: string }[]>`
      SELECT DISTINCT user_id FROM auth.mfa_factors
      WHERE status = 'verified' AND factor_type = 'totp' AND user_id = ANY(${userIds}::uuid[])`
    return new Set(rows.map((r) => r.user_id))
  } catch {
    return null
  }
}
