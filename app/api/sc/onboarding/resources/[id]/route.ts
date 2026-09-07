import { NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { removeOnboardingFiles } from '@/lib/sc/onboarding/storage'

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await ctx.params
  const resource = await prisma.scOnboardingResource.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!resource) return errorResponse('리소스를 찾을 수 없습니다', 404)

  await prisma.scOnboardingResource.delete({ where: { id: resource.id } })

  // 스토리지 정리는 best-effort — 실패해도 DB 삭제는 유지
  if (resource.storagePath) {
    try {
      await removeOnboardingFiles([resource.storagePath])
    } catch (err) {
      console.error('[sc/onboarding] 스토리지 정리 실패:', err)
    }
  }

  return NextResponse.json({ ok: true })
}
