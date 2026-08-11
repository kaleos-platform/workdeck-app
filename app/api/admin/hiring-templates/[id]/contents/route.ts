import { NextRequest, NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { createSampleContentSchema } from '@/lib/validations/hiring-posts'

type Params = { params: Promise<{ id: string }> }

const SAMPLE_SCOPE = { spaceId: null, isSample: true } as const

// POST /api/admin/hiring-templates/[id]/contents — 샘플 템플릿 블록 추가
// 'positions'(직무 정보)는 실제 공고에 종속된 블록이라 샘플 템플릿에서는 추가 불가(스키마에서 차단).
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const { id } = await params

  const template = await prisma.hiringDetailTemplate.findFirst({
    where: { id, ...SAMPLE_SCOPE },
    select: { id: true },
  })
  if (!template) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = createSampleContentSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const last = await prisma.hiringContent.findFirst({
    where: { templateId: id, sourceType: 'DETAIL_TEMPLATE' },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })
  const sortOrder = parsed.data.sortOrder ?? (last ? last.sortOrder + 1 : 0)

  const content = await prisma.hiringContent.create({
    data: {
      spaceId: null,
      templateId: id,
      sourceType: 'DETAIL_TEMPLATE',
      contentType: parsed.data.contentType,
      sortOrder,
      data:
        parsed.data.contentType === 'button' ? { title: '지원하기', linkType: 'form' } : undefined,
    },
  })

  await writeAuditLog(auth.user.id, 'template.content.create', 'hiringContent', content.id, {
    templateId: id,
    contentType: content.contentType,
  })

  return NextResponse.json({ content }, { status: 201 })
}
