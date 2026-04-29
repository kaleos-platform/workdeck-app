import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { improvementRuleInputSchema } from '@/lib/sc/schemas'

export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const rules = await prisma.improvementRule.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: [{ status: 'asc' }, { weight: 'desc' }, { updatedAt: 'desc' }],
  })
  return NextResponse.json({ rules })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = improvementRuleInputSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const rule = await prisma.improvementRule.create({
    data: {
      spaceId: resolved.space.id,
      scope: parsed.data.scope,
      source: 'USER',
      status: parsed.data.status ?? 'ACTIVE',
      title: parsed.data.title,
      body: parsed.data.body,
      weight: parsed.data.weight ?? 5,
      targetProductId: parsed.data.targetProductId ?? null,
      targetPersonaId: parsed.data.targetPersonaId ?? null,
      targetChannelId: parsed.data.targetChannelId ?? null,
    },
  })
  return NextResponse.json({ rule }, { status: 201 })
}
