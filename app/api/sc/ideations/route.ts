import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { runIdeationSchema, userIdeationSchema } from '@/lib/sc/schemas'
import { runIdeation, saveUserIdeation } from '@/lib/sc/ideation'

// GET /api/sc/ideations — 최근 생성된 아이데이션 목록 (요약).
export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const ideations = await prisma.contentIdea.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      userPromptInput: true,
      generatedBy: true,
      providerName: true,
      latencyMs: true,
      createdAt: true,
      product: { select: { id: true, name: true, slug: true } },
      persona: { select: { id: true, name: true, slug: true } },
      ideas: true,
    },
  })

  // ideas 는 client 에서 count 만 써도 충분하지만, 미리보기 제목도 같이 주기 위해 그대로 전달.
  return NextResponse.json({ ideations })
}

// POST /api/sc/ideations — AI 로 새 아이데이션 실행 (기본) 또는 사용자 수동 저장.
// body.mode === 'user' 이면 userIdeationSchema 로 검증, 그 외는 runIdeationSchema.
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const mode = (body as { mode?: string } | null)?.mode ?? 'ai'

  if (mode === 'user') {
    const parsed = userIdeationSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
    }
    const { ideationId } = await saveUserIdeation({
      spaceId: resolved.space.id,
      userId: resolved.user.id,
      productId: parsed.data.productId ?? null,
      personaId: parsed.data.personaId ?? null,
      userPromptInput: parsed.data.userPromptInput ?? null,
      ideas: parsed.data.ideas,
    })
    return NextResponse.json({ ideationId }, { status: 201 })
  }

  const parsed = runIdeationSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const result = await runIdeation({
    spaceId: resolved.space.id,
    userId: resolved.user.id,
    productId: parsed.data.productId ?? null,
    personaId: parsed.data.personaId ?? null,
    userPromptInput: parsed.data.userPromptInput ?? null,
    count: parsed.data.count,
  })

  if (!result.ok) {
    const status = result.code === 'NOT_CONFIGURED' ? 503 : 502
    return errorResponse(result.message, status, {
      code: result.code,
      detail: result.detail,
    })
  }

  return NextResponse.json(
    {
      ideationId: result.ideationId,
      ideas: result.ideas,
      providerName: result.providerName,
    },
    { status: 201 }
  )
}
