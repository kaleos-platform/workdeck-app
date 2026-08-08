/**
 * 웹 어드민 인증/인가 — 다층 방어 2·3계층 (proxy.ts는 호스트+세션까지만, 여기서 role 확정 검증).
 * 모든 app/admin/** layout과 app/api/admin/** route.ts 첫 줄에서 반드시 호출한다.
 */
import 'server-only'
import { NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'

type OperatorContext = { id: string; email: string }

type RequireOperatorResult =
  | { ok: true; user: OperatorContext }
  | { ok: false; response: NextResponse }

function notFoundResponse(): NextResponse {
  // 403이 아닌 404로 존재 자체를 은닉
  return NextResponse.json({ message: 'Not Found' }, { status: 404 })
}

function mfaRequiredResponse(): NextResponse {
  return NextResponse.json(
    { message: 'MFA(aal2)가 필요합니다', code: 'MFA_REQUIRED' },
    { status: 403 }
  )
}

/**
 * 운영자(OPERATOR) 여부를 확정 검증한다.
 * - 미로그인 / platformRole !== 'OPERATOR' → 404 (존재 은닉)
 * - ADMIN_REQUIRE_MFA=true 인데 aal2 미충족 → 403 MFA_REQUIRED
 */
export async function requireOperator(): Promise<RequireOperatorResult> {
  const user = await getUser()
  if (!user) {
    return { ok: false, response: notFoundResponse() }
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { platformRole: true, email: true },
  })
  if (dbUser?.platformRole !== 'OPERATOR') {
    return { ok: false, response: notFoundResponse() }
  }

  if (process.env.ADMIN_REQUIRE_MFA === 'true') {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || data?.currentLevel !== 'aal2') {
      return { ok: false, response: mfaRequiredResponse() }
    }
  }

  return { ok: true, user: { id: user.id, email: dbUser.email } }
}

/**
 * 변경성 admin 작업 감사 로그 기록. 실패 시 throw 전파 — 감사 없는 변경은 허용하지 않는다.
 */
export async function writeAuditLog(
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  meta?: Record<string, unknown>
): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      actorUserId,
      action,
      targetType,
      targetId,
      meta: meta === undefined ? undefined : (meta as Prisma.InputJsonValue),
    },
  })
}
