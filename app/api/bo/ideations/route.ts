import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { runBoIdeationBodySchema } from '@/lib/bo/ideation-schemas'
import { runBoIdeation } from '@/lib/bo/ideation'

// AI 실행 시간 허용 (로컬 CLI 공급자 기준)
export const maxDuration = 120

// GET /api/bo/ideations — 공간 내 최근 아이데이션 목록
export async function GET() {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const ideations = await prisma.boIdeation.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      productId: true,
      userPromptInput: true,
      appealPoints: true,
      providerName: true,
      providerModel: true,
      latencyMs: true,
      promptTraceHash: true,
      createdAt: true,
      product: { select: { id: true, name: true } },
      materials: { select: { id: true, status: true } },
    },
  })

  return NextResponse.json({ ideations })
}

// POST /api/bo/ideations — AI 소구점 발굴 실행
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = runBoIdeationBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const result = await runBoIdeation({
    spaceId: resolved.space.id,
    userId: resolved.user.id,
    productId: parsed.data.productId,
    userPromptInput: parsed.data.userPromptInput ?? null,
  })

  if (!result.ok) {
    const status = result.code === 'PRODUCT_NOT_FOUND' ? 404 : 502
    return errorResponse(result.message, status, { code: result.code, detail: result.detail })
  }

  return NextResponse.json(
    {
      ideationId: result.ideationId,
      appealPointsCount: result.appealPointsCount,
      materialsCount: result.materialsCount,
      providerName: result.providerName,
    },
    { status: 201 }
  )
}
