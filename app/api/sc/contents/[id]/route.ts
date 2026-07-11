import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { contentUpdateSchema } from '@/lib/sc/schemas'
import { snapshotContent } from '@/lib/sc/content-versions'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const content = await prisma.content.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: {
      assets: true,
      channel: { select: { id: true, name: true, platform: true } },
    },
  })
  if (!content) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  return NextResponse.json({ content })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.content.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true },
  })
  if (!existing) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  // PUBLISHED/ANALYZED 상태의 doc 직접 수정 금지 (draft 로 되돌린 후 수정).
  if (existing.status === 'PUBLISHED' || existing.status === 'ANALYZED') {
    return errorResponse('배포 이후에는 직접 수정할 수 없습니다', 409)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = contentUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // 스냅샷 + 업데이트를 원자적으로 실행 — update 실패 시 고아 스냅샷 방지.
  // P2002(versionNumber unique 충돌) 발생 시 전체 트랜잭션을 1회 재시도.
  let updated: Awaited<ReturnType<typeof prisma.content.update>>
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      updated = await prisma.$transaction(async (tx) => {
        // 변경 직전 스냅샷 보존 (tx 전달 — 외부 트랜잭션에서 실행)
        await snapshotContent({
          contentId: id,
          userId: resolved.user?.id,
          note: '자동 스냅샷 (PATCH)',
          tx,
        })

        return tx.content.update({
          where: { id },
          data: {
            title: parsed.data.title ?? undefined,
            doc: (parsed.data.doc ?? undefined) as never,
            channelId: parsed.data.channelId ?? undefined,
            scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined,
            body: parsed.data.body ?? undefined,
            urlSlug: parsed.data.urlSlug ?? undefined,
            targetKeyword: parsed.data.targetKeyword ?? undefined,
            relatedKeywords:
              parsed.data.relatedKeywords !== undefined
                ? (parsed.data.relatedKeywords as never)
                : undefined,
          },
        })
      })
      break
    } catch (err: unknown) {
      const isUniqueViolation =
        err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002'
      if (isUniqueViolation && attempt === 0) continue
      throw err
    }
  }
  return NextResponse.json({ content: updated! })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.content.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true },
  })
  if (!existing) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  if (existing.status === 'PUBLISHED' || existing.status === 'ANALYZED') {
    return errorResponse(
      '게시된 콘텐츠는 삭제할 수 없습니다 — 먼저 보관 처리하세요',
      409,
    )
  }

  await prisma.content.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
