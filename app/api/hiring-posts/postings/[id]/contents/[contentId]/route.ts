import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { buttonDataSchema, updateContentSchema } from '@/lib/validations/hiring-posts'
import { uploadContentImage } from '@/lib/hiring/postings'

type Params = { params: Promise<{ id: string; contentId: string }> }

// 콘텐츠 블록 업데이트
// text 블록: body { data: <Tiptap JSON>, sortOrder? }
// image 블록: body { imageBase64: string, mimeType?: string, sortOrder? }
// contentType 별로 허용 필드가 다르며 상대방 필드를 보내면 400 반환.
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id, contentId } = await params

  const existing = await prisma.hiringContent.findFirst({
    where: { id: contentId, postingId: id, spaceId: resolved.space.id },
    select: { id: true, contentType: true },
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

  // contentType 별 필드 검증
  if (existing.contentType === 'text' && parsed.data.imageBase64 !== undefined) {
    return errorResponse('text 블록에는 imageBase64를 전달할 수 없습니다', 400)
  }
  if (existing.contentType === 'image' && parsed.data.data !== undefined) {
    return errorResponse('image 블록에는 data(Tiptap JSON)를 전달할 수 없습니다', 400)
  }
  // button 블록: imageBase64 불허 + data는 buttonDataSchema로 서버 검증
  // (url에 javascript: 등 비 http(s) 스킴이 저장되면 공개 페이지 <a href>로 렌더되므로 차단)
  if (existing.contentType === 'button') {
    if (parsed.data.imageBase64 !== undefined) {
      return errorResponse('button 블록에는 imageBase64를 전달할 수 없습니다', 400)
    }
    if (parsed.data.data !== undefined) {
      const btn = buttonDataSchema.safeParse(parsed.data.data)
      if (!btn.success) {
        return errorResponse('invalid input', 400, { errors: btn.error.flatten() })
      }
    }
  }

  // 이미지 업로드 — 실패 시 DB 저장 없이 에러 반환
  let imagePath: string | undefined
  if (parsed.data.imageBase64) {
    try {
      imagePath = await uploadContentImage({
        spaceId: resolved.space.id,
        postingId: id,
        imageBase64: parsed.data.imageBase64,
        mimeType: parsed.data.mimeType,
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
