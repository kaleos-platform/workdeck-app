import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { docToMarkdown } from '@/lib/bo/exporters/markdown'
import { docToHtml } from '@/lib/bo/exporters/html'

const exportBodySchema = z.object({
  format: z.enum(['markdown', 'html']),
})

// POST /api/bo/variants/[id]/export — 변형 내보내기 (MD·HTML)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = exportBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const { format } = parsed.data

  // spaceId 검증으로 cross-space 접근 차단
  const variant = await prisma.boPostVariant.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: {
      id: true,
      postId: true,
      channelId: true,
      spaceId: true,
      status: true,
      doc: true,
      exportedMarkdown: true,
      exportedHtml: true,
    },
  })

  if (!variant) return errorResponse('변형을 찾을 수 없습니다', 404)

  // READY 또는 EDITED 상태만 내보내기 허용
  if (variant.status !== 'READY' && variant.status !== 'EDITED') {
    return errorResponse('READY 또는 EDITED 상태의 변형만 내보낼 수 있습니다', 422, {
      status: variant.status,
    })
  }

  // 캐시 재사용 — 동일 포맷이 이미 내보내진 경우
  const cached = format === 'markdown' ? variant.exportedMarkdown : variant.exportedHtml
  if (cached) {
    return NextResponse.json({ content: cached })
  }

  // 내보내기 실행
  let content: string
  try {
    content = format === 'markdown' ? docToMarkdown(variant.doc) : docToHtml(variant.doc)
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : '내보내기 실패', 500)
  }

  // 결과 캐시 저장 + 배포 이력 생성 (트랜잭션)
  await prisma.$transaction([
    prisma.boPostVariant.update({
      where: { id: variant.id },
      data: format === 'markdown' ? { exportedMarkdown: content } : { exportedHtml: content },
    }),
    prisma.boDeployment.create({
      data: {
        spaceId: variant.spaceId,
        postId: variant.postId,
        variantId: variant.id,
        channelId: variant.channelId,
        status: 'EXPORTED',
      },
    }),
  ])

  return NextResponse.json({ content })
}
