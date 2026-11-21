/**
 * GET/PUT /api/admin/platform/google — 운영사 GA4 연동 상태 조회·저장.
 * 첫 줄 requireOperator(404 은닉). 저장은 ADMIN_REQUIRE_MFA=false 여도 aal2 를 요구한다.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperator } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { requireFreshAal2 } from '@/lib/auth/mfa'
import { registerPlatformGoogle } from '@/lib/admin/platform-google'
import { loadPlatformGoogleView } from '@/lib/admin/platform-ga4'

export const runtime = 'nodejs'

const putSchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().max(200).optional(),
  propertyId: z
    .string()
    .trim()
    .regex(/^\d{1,20}$/),
  streamId: z
    .string()
    .trim()
    .regex(/^\d{1,20}$/),
})

export async function GET() {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  return NextResponse.json(await loadPlatformGoogleView())
}

export async function PUT(request: Request) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const mfa = await requireFreshAal2()
  if (mfa) return mfa

  const parsed = putSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값을 확인해 주세요(속성·스트림 ID는 숫자)', 400)

  const result = await registerPlatformGoogle(parsed.data, auth.user.id)
  if (result === 'secret_required') return errorResponse('클라이언트 시크릿을 입력해 주세요', 400)
  if (result === 'conflict') {
    return errorResponse('다른 곳에서 먼저 변경되었습니다. 새로고침 후 다시 시도해 주세요', 409)
  }
  return NextResponse.json({ ok: true })
}
