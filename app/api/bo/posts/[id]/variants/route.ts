import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generateBoVariant } from '@/lib/bo/variant-generator'

// AI 변형 생성 최대 대기 시간 (Vercel Fluid 컴퓨트 기준)
export const maxDuration = 180

const createVariantBodySchema = z.object({
  channelId: z.string().min(1, '채널 ID를 입력하세요'),
})

// GET /api/bo/posts/[id]/variants — 변형 목록 (채널 정보 포함)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id: postId } = await params

  // 포스트가 이 space에 속하는지 검증
  const post = await prisma.boPost.findFirst({
    where: { id: postId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!post) return errorResponse('포스트를 찾을 수 없습니다', 404)

  const variants = await prisma.boPostVariant.findMany({
    where: { postId, spaceId: resolved.space.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      status: true,
      errorMessage: true,
      exportedMarkdown: true,
      exportedHtml: true,
      createdAt: true,
      updatedAt: true,
      channel: {
        select: {
          id: true,
          platform: true,
          name: true,
          isActive: true,
        },
      },
    },
  })

  return NextResponse.json({ variants })
}

// POST /api/bo/posts/[id]/variants — 채널 변형 생성 (또는 재생성)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id: postId } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = createVariantBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('입력값이 올바르지 않습니다', 400, { errors: parsed.error.flatten() })
  }

  const result = await generateBoVariant({
    postId,
    channelId: parsed.data.channelId,
    spaceId: resolved.space.id,
  })

  if (!result.ok) {
    const status =
      result.code === 'POST_NOT_FOUND' || result.code === 'CHANNEL_NOT_FOUND'
        ? 404
        : result.code === 'POST_NOT_APPROVED'
          ? 422
          : 500

    return errorResponse(result.message, status, {
      code: result.code,
      ...(result.variantId ? { variantId: result.variantId } : {}),
    })
  }

  return NextResponse.json(
    { variantId: result.variantId, providerName: result.providerName },
    { status: 201 }
  )
}
