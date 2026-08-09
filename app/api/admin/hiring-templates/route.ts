import { NextRequest, NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { createSampleTemplateSchema } from '@/lib/validations/hiring-posts'

// GET /api/admin/hiring-templates — 글로벌 샘플 템플릿 목록 (spaceId=null, isSample=true 고정 스코프)
export async function GET() {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const templates = await prisma.hiringDetailTemplate.findMany({
    where: { spaceId: null, isSample: true },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      imagePath: true,
      updatedAt: true,
      _count: { select: { contents: true } },
    },
  })

  return NextResponse.json({ templates })
}

// POST /api/admin/hiring-templates — 빈 샘플 템플릿 생성
export async function POST(req: NextRequest) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = createSampleTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const template = await prisma.hiringDetailTemplate.create({
    data: { spaceId: null, isSample: true, name: parsed.data.name },
  })

  await writeAuditLog(auth.user.id, 'template.create', 'hiringDetailTemplate', template.id, {
    name: template.name,
  })

  return NextResponse.json({ template }, { status: 201 })
}
