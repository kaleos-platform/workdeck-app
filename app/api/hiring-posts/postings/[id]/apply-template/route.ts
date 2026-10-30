import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { applyTemplateSchema } from '@/lib/validations/hiring-posts'

type Params = { params: Promise<{ id: string }> }

// 상세 템플릿을 공고에 적용 — 기존 POSTING_DETAIL 블록 전체 교체
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = applyTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }
  if (parsed.data.mode === 'replace' && !parsed.data.expectedContents) {
    return errorResponse('카드 버전이 없습니다. 새로고침해 주세요.', 428)
  }

  const posting = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!posting) return errorResponse('공고를 찾을 수 없습니다', 404)

  const template = await prisma.hiringDetailTemplate.findFirst({
    where: {
      id: parsed.data.templateId,
      OR: [{ spaceId: resolved.space.id }, { isSample: true }],
    },
    select: {
      id: true,
      name: true,
      contents: {
        where: { sourceType: 'DETAIL_TEMPLATE' },
        orderBy: { sortOrder: 'asc' },
        select: { contentType: true, title: true, data: true, imagePath: true, sortOrder: true },
      },
    },
  })
  if (!template) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  const conflict = new Error('CONTENT_CONFLICT')
  let contents
  try {
    contents = await prisma.$transaction(async (tx) => {
      // 같은 공고의 카드 추가와 템플릿 적용은 목록 확인부터 완료까지 직렬화한다.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hiring-content:${id}`}))`
      // replace: 기존 블록 전체 삭제 후 0부터. append: 삭제 없이 기존 max sortOrder 다음부터 이어붙임.
      let base = 0
      if (parsed.data.mode === 'replace') {
        const expected = parsed.data.expectedContents!
        const current = await tx.hiringContent.findMany({
          where: { postingId: id, spaceId: resolved.space.id, sourceType: 'POSTING_DETAIL' },
          select: { id: true },
        })
        const ids = new Set(expected.map((item) => item.id))
        if (
          ids.size !== expected.length ||
          current.length !== expected.length ||
          current.some((item) => !ids.has(item.id))
        )
          throw conflict
        if (expected.length) {
          const deleted = await tx.hiringContent.deleteMany({
            where: {
              postingId: id,
              spaceId: resolved.space.id,
              sourceType: 'POSTING_DETAIL',
              OR: expected.map((item) => ({ id: item.id, updatedAt: new Date(item.updatedAt) })),
            },
          })
          if (deleted.count !== expected.length) throw conflict
        }
      } else {
        const agg = await tx.hiringContent.aggregate({
          where: { postingId: id, sourceType: 'POSTING_DETAIL' },
          _max: { sortOrder: true },
        })
        base = (agg._max.sortOrder ?? -1) + 1
      }
      if (template.contents.length > 0) {
        await tx.hiringContent.createMany({
          data: template.contents.map((c, i) => ({
            spaceId: resolved.space.id,
            sourceType: 'POSTING_DETAIL' as const,
            postingId: id,
            contentType: c.contentType,
            title: c.title,
            data: (c.data ?? undefined) as Prisma.InputJsonValue | undefined,
            imagePath: c.imagePath,
            sortOrder: base + i,
          })),
        })
      }
      // 표시용 템플릿 스냅샷 기록
      await tx.hiringPosting.update({
        where: { id },
        data: {
          appliedTemplateId: template.id,
          appliedTemplateName: template.name,
          appliedTemplateAt: new Date(),
        },
      })
      // 반환용 조회 실패도 변경과 함께 롤백해 적용 완료를 실패로 오인하지 않도록 한다.
      return tx.hiringContent.findMany({
        where: { postingId: id, sourceType: 'POSTING_DETAIL' },
        orderBy: { sortOrder: 'asc' },
      })
    })
  } catch (error) {
    if (error === conflict)
      return errorResponse(
        '다른 창에서 카드가 변경되었습니다. 입력을 복사한 뒤 새로고침해 주세요.',
        409
      )
    throw error
  }
  return NextResponse.json({ contents })
}
