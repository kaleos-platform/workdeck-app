import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import {
  blockLinkSchema,
  buttonDataSchema,
  updateContentSchema,
  MAX_CONTENT_DATA_CHARS,
} from '@/lib/validations/hiring-posts'
import { uploadContentImage } from '@/lib/hiring/postings'
import { deletePostingAsset } from '@/lib/hiring/storage'

type Params = { params: Promise<{ id: string; contentId: string }> }

// 콘텐츠 블록 업데이트
// text 블록: body { data: <Tiptap JSON>, sortOrder? }
// image 블록: body { imageBase64: string, mimeType?: string, sortOrder? }
// contentType 별로 허용 필드가 다르며 상대방 필드를 보내면 400 반환.
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error
  const { id, contentId } = await params

  const existing = await prisma.hiringContent.findFirst({
    where: { id: contentId, postingId: id, spaceId: resolved.space.id },
    select: { id: true, contentType: true, updatedAt: true },
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

  if (!parsed.data.expectedUpdatedAt) {
    return errorResponse('카드 버전이 없습니다. 입력을 복사한 뒤 새로고침해 주세요.', 428)
  }
  const expectedUpdatedAt = parsed.data.expectedUpdatedAt
    ? new Date(parsed.data.expectedUpdatedAt)
    : undefined
  const conflictMessage = '다른 창에서 카드가 변경되었습니다. 입력을 복사한 뒤 새로고침해 주세요.'
  if (expectedUpdatedAt && existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    return errorResponse(conflictMessage, 409)
  }

  // image 블록 data 는 링크 설정만 허용 — { link?: BlockLink }
  const imageDataSchema = z.object({ link: blockLinkSchema.optional() })

  // contentType 별 필드 검증
  if (existing.contentType === 'text' && parsed.data.imageBase64 !== undefined) {
    return errorResponse('text 블록에는 imageBase64를 전달할 수 없습니다', 400)
  }
  // image 블록: 이미지(imageBase64)와 링크(data.link) 저장 허용. data 는 링크 외 필드 불허.
  if (existing.contentType === 'image' && parsed.data.data !== undefined) {
    const img = imageDataSchema.safeParse(parsed.data.data)
    if (!img.success) {
      return errorResponse('invalid input', 400, { errors: img.error.flatten() })
    }
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
  // design 블록: scene JSON(data) 크기 상한 — image와 동일 상한 재사용 + 선택적 link 검증.
  // link 는 scene JSON 최상위에 병존하는 키(excalidraw 로더는 elements/appState/files 만 읽음).
  if (existing.contentType === 'design' && parsed.data.data !== undefined) {
    if (JSON.stringify(parsed.data.data).length > MAX_CONTENT_DATA_CHARS) {
      return errorResponse('디자인 데이터가 너무 큽니다. 캔버스의 이미지를 줄여주세요', 400)
    }
    const link = (parsed.data.data as { link?: unknown } | null)?.link
    if (link !== undefined) {
      const parsedLink = blockLinkSchema.safeParse(link)
      if (!parsedLink.success) {
        return errorResponse('invalid input', 400, { errors: parsedLink.error.flatten() })
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

  try {
    const content = await prisma.hiringContent.update({
      where: { id: contentId, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
      data: {
        // 빠른 연속 저장에서도 이전 카드 버전과 같지 않도록 단조 증가시킨다.
        updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)),
        // title 은 모든 블록 타입 공통 필드 — null 이면 리스트에서 "카드 N" 폴백으로 표시.
        ...(parsed.data.title !== undefined && { title: parsed.data.title }),
        ...(parsed.data.data !== undefined && {
          data: parsed.data.data as Prisma.InputJsonValue,
        }),
        ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
        ...(imagePath !== undefined && { imagePath }),
      },
    })
    return NextResponse.json({ content })
  } catch (error) {
    const isConflict =
      error && typeof error === 'object' && 'code' in error && error.code === 'P2025'
    // 커밋 결과가 불확실한 오류에서는 저장된 이미지일 수 있으므로 삭제하지 않는다.
    if (imagePath && isConflict) {
      try {
        await deletePostingAsset(imagePath)
      } catch {
        console.error('[hiring-posts content PATCH] 미참조 이미지 정리 실패')
      }
    }
    if (isConflict) {
      return errorResponse(conflictMessage, 409)
    }
    throw error
  }
}

// 콘텐츠 블록 삭제
export async function DELETE(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error
  const { id, contentId } = await params

  const existing = await prisma.hiringContent.findFirst({
    where: { id: contentId, postingId: id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  const version = req.headers.get('x-content-version')
  if (!version) return errorResponse('카드 버전이 없습니다. 새로고침해 주세요.', 428)
  const parsedVersion = z.string().datetime().safeParse(version)
  if (!parsedVersion.success) return errorResponse('카드 버전이 올바르지 않습니다', 400)
  try {
    await prisma.hiringContent.delete({ where: { id: contentId, updatedAt: new Date(version) } })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
      return errorResponse('다른 창에서 카드가 변경되었습니다. 새로고침해 주세요.', 409)
    }
    throw error
  }
  return NextResponse.json({ ok: true })
}
