import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { updateContentSchema } from '@/lib/validations/hiring-posts'
import { uploadContentImage } from '@/lib/hiring/postings'

type Params = { params: Promise<{ id: string; contentId: string }> }

// 콘텐츠 블록 저장 (scene JSON + export PNG 업로드)
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id, contentId } = await params

  const existing = await prisma.hiringContent.findFirst({
    where: { id: contentId, postingId: id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = updateContentSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // PNG 업로드 (선택) — 실패해도 scene 저장은 진행하지 않고 에러 반환
  let imagePath: string | undefined
  if (parsed.data.imageBase64) {
    try {
      imagePath = await uploadContentImage({
        spaceId: resolved.space.id,
        postingId: id,
        imageBase64: parsed.data.imageBase64,
      })
    } catch (err) {
      console.error('[hiring-posts content PATCH] 이미지 업로드 실패', err)
      return errorResponse('이미지 업로드에 실패했습니다', 502)
    }
  }

  const content = await prisma.hiringContent.update({
    where: { id: contentId },
    data: {
      ...(parsed.data.data !== undefined && {
        data: parsed.data.data as Prisma.InputJsonValue,
      }),
      ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
      ...(imagePath !== undefined && { imagePath }),
    },
  })
  return NextResponse.json({ content })
}

// 콘텐츠 블록 삭제
export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id, contentId } = await params

  const existing = await prisma.hiringContent.findFirst({
    where: { id: contentId, postingId: id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  await prisma.hiringContent.delete({ where: { id: contentId } })
  return NextResponse.json({ ok: true })
}
