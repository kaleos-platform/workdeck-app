import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

// 공고 복사 — DRAFT 상태로 새 공고 생성 (마감일 제외)
export async function POST(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const source = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: {
      positions: true,
      stores: true,
      contents: { where: { postingId: id } },
    },
  })
  if (!source) return errorResponse('공고를 찾을 수 없습니다', 404)

  const posting = await prisma.$transaction(async (tx) => {
    const newPosting = await tx.hiringPosting.create({
      data: {
        spaceId: source.spaceId,
        title: `${source.title} (복사)`,
        status: 'DRAFT',
        applicationEntries: source.applicationEntries ?? undefined,
        detail: source.detail ?? undefined,
        notificationEnabled: source.notificationEnabled,
        closingDate: null,
        // managerNameEnc 등 enc 필드는 null 유지
      },
      select: { id: true },
    })

    if (source.positions.length > 0) {
      await tx.hiringPostingPosition.createMany({
        data: source.positions.map((p) => ({
          spaceId: p.spaceId,
          postingId: newPosting.id,
          positionId: p.positionId,
          name: p.name,
          jobType: p.jobType,
          payFrequency: p.payFrequency,
          payAmount: p.payAmount,
          workDays: p.workDays ?? undefined,
          workStartAt: p.workStartAt,
          workEndAt: p.workEndAt,
          headcount: p.headcount,
          experience: p.experience,
          education: p.education,
          jobDescription: p.jobDescription,
          requiredQualifications: p.requiredQualifications,
          preferredQualifications: p.preferredQualifications,
        })),
      })
    }

    if (source.stores.length > 0) {
      await tx.hiringPostingStore.createMany({
        data: source.stores.map((s) => ({
          postingId: newPosting.id,
          storeId: s.storeId,
        })),
      })
    }

    if (source.contents.length > 0) {
      await tx.hiringContent.createMany({
        data: source.contents.map((c) => ({
          spaceId: c.spaceId,
          sourceType: c.sourceType,
          postingId: newPosting.id,
          contentType: c.contentType,
          data: c.data ?? undefined,
          imagePath: c.imagePath,
          sortOrder: c.sortOrder,
        })),
      })
    }

    return newPosting
  })

  return NextResponse.json({ posting: { id: posting.id } }, { status: 201 })
}
