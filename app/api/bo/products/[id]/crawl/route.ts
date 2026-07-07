import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { crawlHomepage, CrawlError } from '@/lib/bo/crawler'

export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const product = await prisma.boProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!product) return errorResponse('제품을 찾을 수 없습니다', 404)

  if (!product.homepageUrl) {
    return errorResponse('홈페이지 URL이 등록되지 않았습니다', 400)
  }

  // PENDING 상태로 업데이트
  await prisma.boProduct.update({
    where: { id },
    data: { crawlStatus: 'PENDING' },
  })

  try {
    const { text, fetchedAt } = await crawlHomepage(product.homepageUrl)

    const updated = await prisma.boProduct.update({
      where: { id },
      data: {
        crawlStatus: 'DONE',
        crawledText: text,
        crawledAt: fetchedAt,
      },
    })

    return NextResponse.json({ product: updated })
  } catch (err) {
    const message = err instanceof CrawlError ? err.message : '크롤링 중 오류가 발생했습니다'

    await prisma.boProduct.update({
      where: { id },
      data: { crawlStatus: 'FAILED' },
    })

    return errorResponse(message, 422)
  }
}
