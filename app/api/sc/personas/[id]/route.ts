import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { personaSchema } from '@/lib/sc/schemas'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const persona = await prisma.persona.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!persona) return errorResponse('페르소나를 찾을 수 없습니다', 404)

  return NextResponse.json({ persona })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.persona.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!existing) return errorResponse('페르소나를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = personaSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const data = parsed.data

  const persona = await prisma.persona.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.jobTitle !== undefined && { jobTitle: data.jobTitle ?? null }),
      ...(data.industry !== undefined && { industry: data.industry ?? null }),
      ...(data.customFields !== undefined && { customFields: (data.customFields ?? []) as never }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  })
  return NextResponse.json({ persona })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.persona.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!existing) return errorResponse('페르소나를 찾을 수 없습니다', 404)

  await prisma.persona.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
