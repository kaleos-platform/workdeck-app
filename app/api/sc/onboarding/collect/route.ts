import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { collectPage, MAX_COLLECTION_RESOURCES, resourceSelect } from '@/lib/sc/onboarding/crawl'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    ('resourceId' in body && (typeof body.resourceId !== 'string' || !body.resourceId))
  )
    return errorResponse('잘못된 요청 형식입니다', 400)
  const resourceId = 'resourceId' in body ? (body.resourceId as string) : undefined
  const resource = await prisma.scOnboardingResource.findFirst({
    where: {
      spaceId,
      kind: 'URL',
      ...(resourceId
        ? { id: resourceId, status: { in: ['PENDING', 'FAILED'] } }
        : { status: 'PENDING' }),
    },
    orderBy: { createdAt: 'asc' },
  })
  if (resourceId && !resource) return errorResponse('재시도할 수집 자료를 찾을 수 없습니다', 404)
  let warning: string | undefined
  if (resource?.sourceUrl) {
    try {
      const collected = await collectPage(resource.sourceUrl)
      await prisma.$transaction(async (tx) => {
        // 네트워크 요청은 잠금 밖에서 실행하고 등록만 직렬화한다.
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${spaceId}))`
        const current = await tx.scOnboardingResource.findFirst({
          where: { id: resource.id, spaceId },
        })
        if (!current || current.status === 'DONE') return
        const all = await tx.scOnboardingResource.findMany({
          where: { spaceId },
          select: { sourceUrl: true },
        })
        const existing = new Set(all.map((item) => item.sourceUrl))
        const discovered = collected.links.filter((url) => !existing.has(url))
        const available = Math.max(0, MAX_COLLECTION_RESOURCES - all.length)
        if (discovered.length > available)
          warning = `수집 안전 한도 ${MAX_COLLECTION_RESOURCES}건에 도달하여 일부 링크가 남았습니다. 전체 상품 수집이 완료되지 않았습니다.`
        if (discovered.length && available)
          await tx.scOnboardingResource.createMany({
            data: discovered.slice(0, available).map((sourceUrl) => ({
              spaceId,
              kind: 'URL' as const,
              sourceUrl,
              status: 'PENDING' as const,
            })),
          })
        await tx.scOnboardingResource.update({
          where: { id: resource.id },
          data: {
            status: 'DONE',
            extractedText: JSON.stringify(collected.page),
            errorMessage: warning ?? null,
          },
        })
      })
    } catch (err) {
      await prisma.scOnboardingResource.updateMany({
        where: { id: resource.id, spaceId, status: { not: 'DONE' } },
        data: {
          status: 'FAILED',
          errorMessage: err instanceof Error ? err.message : 'URL 수집에 실패했습니다',
        },
      })
    }
  }
  const resources = await prisma.scOnboardingResource.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'asc' },
    select: resourceSelect,
  })
  return NextResponse.json({
    resources,
    pending: resources.filter((item) => item.status === 'PENDING').length,
    ...(resource ? { processed: resource.id } : {}),
    ...(warning ? { warning } : {}),
  })
}
