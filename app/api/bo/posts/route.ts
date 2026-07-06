import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { runBoDraftGeneration } from '@/lib/bo/draft-generator'
import { createBoPostBodySchema } from '@/lib/bo/post-schemas'
import type { BoPostStatus } from '@/generated/prisma/client'

// AI 생성 최대 대기 시간 (Vercel Fluid 컴퓨트 기준)
export const maxDuration = 180

const listQuerySchema = z.object({
  status: z
    .enum([
      'GENERATING',
      'DRAFT',
      'IN_REVIEW',
      'PUBLISH_APPROVED',
      'PUBLISHED',
      'FAILED',
      'ARCHIVED',
    ])
    .optional(),
  materialId: z.string().optional(),
})

// GET /api/bo/posts — 포스트 목록 (status · materialId 필터)
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { searchParams } = new URL(req.url)
  const query = listQuerySchema.safeParse({
    status: searchParams.get('status') ?? undefined,
    materialId: searchParams.get('materialId') ?? undefined,
  })
  if (!query.success) {
    return errorResponse('invalid query', 400, { errors: query.error.flatten() })
  }

  const posts = await prisma.boPost.findMany({
    where: {
      spaceId: resolved.space.id,
      ...(query.data.status ? { status: query.data.status as BoPostStatus } : {}),
      ...(query.data.materialId ? { materialId: query.data.materialId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      title: true,
      status: true,
      targetKeyword: true,
      ctaUrl: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
      material: { select: { id: true, title: true } },
    },
  })

  return NextResponse.json({ posts })
}

// POST /api/bo/posts — 소재 기반 AI 초안 생성
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = createBoPostBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const result = await runBoDraftGeneration({
    materialId: parsed.data.materialId,
    spaceId: resolved.space.id,
    userId: resolved.user.id,
  })

  if (!result.ok) {
    const status =
      result.code === 'MATERIAL_NOT_FOUND'
        ? 404
        : result.code === 'MATERIAL_NOT_APPROVED'
          ? 422
          : 500
    return errorResponse(result.message, status, {
      code: result.code,
      ...(result.postId ? { postId: result.postId } : {}),
    })
  }

  return NextResponse.json(
    { postId: result.postId, providerName: result.providerName },
    { status: 201 }
  )
}
