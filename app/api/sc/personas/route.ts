import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { personaSchema } from '@/lib/sc/schemas'

export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const personas = await prisma.persona.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ personas })
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

  const parsed = personaSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const data = parsed.data

  try {
    const persona = await prisma.persona.create({
      data: {
        spaceId: resolved.space.id,
        name: data.name,
        slug: data.slug,
        jobTitle: data.jobTitle ?? null,
        industry: data.industry ?? null,
        companySize: data.companySize ?? null,
        seniority: data.seniority ?? null,
        decisionRole: data.decisionRole ?? null,
        goals: data.goals ?? undefined,
        painPoints: data.painPoints ?? undefined,
        objections: data.objections ?? undefined,
        preferredChannels: data.preferredChannels ?? undefined,
        toneHints: data.toneHints ?? null,
        isActive: data.isActive,
      },
    })
    return NextResponse.json({ persona }, { status: 201 })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('이미 동일한 slug의 페르소나가 존재합니다', 409)
    }
    throw err
  }
}
