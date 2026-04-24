import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { improvementRuleInputSchema } from '@/lib/sc/schemas'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.improvementRule.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('규칙을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = improvementRuleInputSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const updated = await prisma.improvementRule.update({
    where: { id },
    data: {
      scope: parsed.data.scope ?? undefined,
      status: parsed.data.status ?? undefined,
      title: parsed.data.title ?? undefined,
      body: parsed.data.body ?? undefined,
      weight: parsed.data.weight ?? undefined,
      targetProductId: parsed.data.targetProductId ?? undefined,
      targetPersonaId: parsed.data.targetPersonaId ?? undefined,
      targetChannelId: parsed.data.targetChannelId ?? undefined,
    },
  })
  return NextResponse.json({ rule: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.improvementRule.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('규칙을 찾을 수 없습니다', 404)

  await prisma.improvementRule.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
