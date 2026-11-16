// 자주 쓰는 메시지 목록/생성 — 목록은 읽기 권한, 생성은 쓰기 권한. spaceId 스코프.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, canWriteDeck, errorResponse } from '@/lib/api-helpers'
import { assertDeckWritable } from '@/lib/billing/entitlement'
import type { Prisma } from '@/generated/prisma/client'
import { messageTemplateSchema } from '@/lib/validations/hiring-applicants'
import { SAMPLE_MESSAGES } from '@/lib/hiring/message-template'

const SELECT = { id: true, title: true, content: true, updatedAt: true } as const

const lockSeed = (tx: Prisma.TransactionClient, spaceId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hiring-msg-samples:' || ${spaceId}))`

// 공간당 한 번만 예시를 넣는다. 쓰기 가능한 요청에서만, 실패해도 목록 조회는 계속한다.
async function seedOnce(spaceId: string) {
  try {
    await prisma.$transaction(async (tx) => {
      await lockSeed(tx, spaceId)
      if (await tx.hiringMessageSeed.findUnique({ where: { spaceId } })) return
      await tx.hiringMessageSeed.create({ data: { spaceId } })
      if ((await tx.hiringMessageTemplate.count({ where: { spaceId } })) > 0) return
      await tx.hiringMessageTemplate.createMany({
        data: SAMPLE_MESSAGES.map((m) => ({ spaceId, ...m })),
      })
    })
  } catch (e) {
    console.error(
      '[message-templates] 예시 메시지 seed 실패',
      e instanceof Error ? e.name : 'error'
    )
  }
}

export async function GET() {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  // resolveDeckContext의 write 판정(역할 + 구독 만료)과 같은 조건을 통과할 때만 seed
  if (
    !(await prisma.hiringMessageSeed.findUnique({ where: { spaceId } })) &&
    canWriteDeck('recruiting', resolved.role) &&
    !(await assertDeckWritable(spaceId, 'recruiting'))
  ) {
    await seedOnce(spaceId)
  }

  const items = await prisma.hiringMessageTemplate.findMany({
    where: { spaceId },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: SELECT,
  })
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const parsed = messageTemplateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse('제목과 내용을 입력하세요', 400)

  // 같은 lock + seed 기록 후 생성 — 먼저 만든 공간에는 예시가 끼어들지 않는다
  const item = await prisma.$transaction(async (tx) => {
    await lockSeed(tx, spaceId)
    await tx.hiringMessageSeed.upsert({ where: { spaceId }, create: { spaceId }, update: {} })
    return tx.hiringMessageTemplate.create({
      data: { spaceId, title: parsed.data.title, content: parsed.data.content },
      select: SELECT,
    })
  })
  return NextResponse.json({ item }, { status: 201 })
}
