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
  | { ok: false; reason: 'NOT_OPERATOR'; response: NextResponse }
  | { ok: false; reason: 'MFA_REQUIRED'; user: OperatorContext; response: NextResponse }

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
    return { ok: false, reason: 'NOT_OPERATOR', response: notFoundResponse() }
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { platformRole: true, email: true },
  })
  if (dbUser?.platformRole !== 'OPERATOR') {
    return { ok: false, reason: 'NOT_OPERATOR', response: notFoundResponse() }
  }

  const operator: OperatorContext = { id: user.id, email: dbUser.email }

  // ⚠️ ADMIN_REQUIRE_MFA 는 아직 켜면 안 된다 — 켜는 순간 운영자가 영구 잠긴다.
  // 로그인 폼에 MFA 챌린지 단계가 없어서, 등록 직후(aal2)를 제외하면 재로그인은 항상 aal1 이다.
  // aal1 에서는 어드민 접근이 막히고, 해제(unenroll)마저 Supabase 가 aal2 를 요구해 실패한다.
  // 켜려면 먼저 aal1 → aal2 승급 경로(계정 페이지의 코드 입력 또는 로그인 폼의 MFA 단계)가 필요하다.
  // 그때까지 /admin/account 의 MFA 섹션은 "등록만 가능한" 상태로 둔다.
  if (process.env.ADMIN_REQUIRE_MFA === 'true') {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || data?.currentLevel !== 'aal2') {
      return { ok: false, reason: 'MFA_REQUIRED', user: operator, response: mfaRequiredResponse() }
    }
  }

  return { ok: true, user: operator }
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
