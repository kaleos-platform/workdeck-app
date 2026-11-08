import { NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { VerifiedSource } from '@/lib/sc/osmu/evidence'

type Params = { params: Promise<{ id: string }> }

/** GET: 승인 화면용 — 발행 요청의 소재(사실·인용·근거)와 제안 시점 사진 복사본. */
export async function GET(_req: Request, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error
  const { id } = await params
  const r = await prisma.scPublishRequest.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: {
      snapshot: true,
      source: { select: { title: true } },
      sourceVersion: { select: { version: true, data: true } },
      mediaCopies: {
        select: { id: true, url: true, media: { select: { name: true, caption: true } } },
      },
    },
  })
  if (!r) return errorResponse('발행 요청을 찾을 수 없습니다', 404)
  const data = r.sourceVersion?.data as VerifiedSource | undefined
  return NextResponse.json({
    request: r.snapshot,
    source: r.source
      ? {
          title: r.source.title,
          version: r.sourceVersion?.version ?? null,
          facts: data?.facts ?? [],
          quotes: data?.quotes ?? [],
        }
      : null,
    copies: r.mediaCopies.map((c) => ({
      id: c.id,
      url: c.url,
      name: c.media.name,
      caption: c.media.caption,
    })),
  })
}
