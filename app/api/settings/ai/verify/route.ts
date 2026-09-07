/**
 * POST /api/settings/ai/verify — 저장된 설정으로 최소 호출을 날려 연결을 확인한다.
 * 성공 시 lastVerifiedAt 갱신, 실패 시 lastError 기록. 키는 응답에 포함하지 않는다.
 */
import { NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { errorResponse, assertRole, resolveSpaceContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { resolveSpaceAiProvider } from '@/lib/ai/resolve'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST() {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)
  const ctx = await resolveSpaceContext()
  if ('error' in ctx) return ctx.error
  const roleError = assertRole(ctx.role, 'ADMIN')
  if (roleError) return roleError
  const spaceId = ctx.space.id

  let resolution: Awaited<ReturnType<typeof resolveSpaceAiProvider>>
  try {
    resolution = await resolveSpaceAiProvider(spaceId)
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'AI 설정을 확인할 수 없습니다', 400)
  }

  try {
    // 실제 생성 호출로 확인한다 — healthcheck 만으로는 모델명 오류를 못 잡는다.
    const result = await resolution.provider.generate({
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 16,
    })
    await prisma.spaceAiSetting.updateMany({
      where: { spaceId },
      data: { lastVerifiedAt: new Date(), lastError: null },
    })
    return NextResponse.json({
      ok: true,
      mode: resolution.mode,
      provider: resolution.provider.name,
      model: result.model ?? null,
    })
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    await prisma.spaceAiSetting.updateMany({ where: { spaceId }, data: { lastError: message } })
    return NextResponse.json({ ok: false, mode: resolution.mode, error: message }, { status: 200 })
  }
}
