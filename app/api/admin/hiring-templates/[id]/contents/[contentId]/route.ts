import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import {
  blockLinkSchema,
  buttonDataSchema,
  updateContentSchema,
  MAX_CONTENT_DATA_CHARS,
} from '@/lib/validations/hiring-posts'
import { uploadSampleTemplateAsset } from '@/lib/hiring/storage'

type Params = { params: Promise<{ id: string; contentId: string }> }

const SAMPLE_SCOPE = { spaceId: null, isSample: true } as const

// 콘텐츠 블록 업데이트 — app/api/hiring-posts/postings/[id]/contents/[contentId]/route.ts PATCH 이식
// (postingId 스코프 대신 templateId + isSample 글로벌 샘플 스코프)
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const { id, contentId } = await params

  const template = await prisma.hiringDetailTemplate.findFirst({
    where: { id, ...SAMPLE_SCOPE },
    select: { id: true },
  })
  if (!template) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  const existing = await prisma.hiringContent.findFirst({
    where: { id: contentId, templateId: id, sourceType: 'DETAIL_TEMPLATE' },
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

  // 직무 정보 블록은 실제 공고에 종속된 콘텐츠라 샘플 템플릿에서는 제목·순서 외 편집 불가.
  if (existing.contentType === 'positions') {
    if (parsed.data.data !== undefined || parsed.data.imageBase64 !== undefined) {
      return errorResponse('직무 정보 블록은 이 화면에서 편집할 수 없습니다', 400)
    }
  }

  const imageDataSchema = z.object({ link: blockLinkSchema.optional() })

  if (existing.contentType === 'text' && parsed.data.imageBase64 !== undefined) {
    return errorResponse('text 블록에는 imageBase64를 전달할 수 없습니다', 400)
  }
  if (existing.contentType === 'image' && parsed.data.data !== undefined) {
    const img = imageDataSchema.safeParse(parsed.data.data)
    if (!img.success) {
      return errorResponse('invalid input', 400, { errors: img.error.flatten() })
    }
  }
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

  let imagePath: string | undefined
  if (parsed.data.imageBase64) {
    try {
      const base64 = parsed.data.imageBase64.includes(',')
        ? parsed.data.imageBase64.split(',')[1]
        : parsed.data.imageBase64
      const buffer = Buffer.from(base64, 'base64')
      const uploaded = await uploadSampleTemplateAsset({
        templateId: id,
        data: buffer,
        mimeType: parsed.data.mimeType ?? 'image/png',
      })
      imagePath = uploaded.path
    } catch (err) {
      console.error('[admin hiring-templates content PATCH] 이미지 업로드 실패', err)
      return errorResponse('이미지 업로드에 실패했습니다', 502)
    }
  }

  const content = await prisma.hiringContent.update({
    where: { id: contentId },
    data: {
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.data !== undefined && {
        data: parsed.data.data as Prisma.InputJsonValue,
      }),
      ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
      ...(imagePath !== undefined && { imagePath }),
    },
  })

  await writeAuditLog(auth.user.id, 'template.content.update', 'hiringContent', contentId, {
    templateId: id,
    fields: Object.keys(parsed.data),
  })

  return NextResponse.json({ content })
}

// 콘텐츠 블록 삭제
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const { id, contentId } = await params

  const template = await prisma.hiringDetailTemplate.findFirst({
    where: { id, ...SAMPLE_SCOPE },
    select: { id: true },
  })
  if (!template) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  const existing = await prisma.hiringContent.findFirst({
    where: { id: contentId, templateId: id, sourceType: 'DETAIL_TEMPLATE' },
    select: { id: true },
  })
  if (!existing) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  await writeAuditLog(auth.user.id, 'template.content.delete', 'hiringContent', contentId, {
    templateId: id,
  })

  await prisma.hiringContent.delete({ where: { id: contentId } })
  return NextResponse.json({ ok: true })
}
