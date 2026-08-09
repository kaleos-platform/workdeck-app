import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

const SAMPLE_SCOPE = { spaceId: null, isSample: true } as const

// GET /api/admin/hiring-templates/[id] — 상세(블록 전체, sortOrder 정렬)
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const { id } = await params

  const template = await prisma.hiringDetailTemplate.findFirst({
    where: { id, ...SAMPLE_SCOPE },
    select: {
      id: true,
      name: true,
      imagePath: true,
      updatedAt: true,
      contents: {
        where: { sourceType: 'DETAIL_TEMPLATE' },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
  if (!template) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  const { contents, ...meta } = template
  return NextResponse.json({ template: meta, contents })
}

const patchSchema = z
  .object({
    name: z.string().min(1, '템플릿 이름을 입력하세요').max(200).optional(),
    imagePath: z.string().nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.imagePath !== undefined, {
    message: 'name 또는 imagePath 중 하나는 필요합니다',
  })

// PATCH /api/admin/hiring-templates/[id] — 이름/대표이미지 변경
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const { id } = await params

  const existing = await prisma.hiringDetailTemplate.findFirst({
    where: { id, ...SAMPLE_SCOPE },
    select: { id: true },
  })
  if (!existing) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const template = await prisma.hiringDetailTemplate.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.imagePath !== undefined && { imagePath: parsed.data.imagePath }),
    },
  })

  await writeAuditLog(auth.user.id, 'template.update', 'hiringDetailTemplate', id, parsed.data)

  return NextResponse.json({ template })
}

// DELETE /api/admin/hiring-templates/[id] — 템플릿 삭제 (HiringContent onDelete: Cascade)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const { id } = await params

  const existing = await prisma.hiringDetailTemplate.findFirst({
    where: { id, ...SAMPLE_SCOPE },
    select: { id: true, name: true },
  })
  if (!existing) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  // 감사 로그 선기록 (삭제 후에는 대상 정보를 재조회할 수 없음)
  await writeAuditLog(auth.user.id, 'template.delete', 'hiringDetailTemplate', id, {
    name: existing.name,
  })

  await prisma.hiringDetailTemplate.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
