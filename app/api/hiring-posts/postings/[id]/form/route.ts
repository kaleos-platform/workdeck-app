import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { updateFormSchema } from '@/lib/validations/hiring-posts'
import { formHasRequiredStandardFields } from '@/lib/hiring/postings'

type Params = { params: Promise<{ id: string }> }

// 지원서 폼 스키마(applicationEntries) 저장
export async function PUT(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('hiring-posts')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const existing = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('공고를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = updateFormSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // 필수 표준 항목(name/phone) 보장
  if (!formHasRequiredStandardFields(parsed.data.fields)) {
    return errorResponse('지원서 폼에는 이름·연락처 항목이 필요합니다', 400)
  }

  await prisma.hiringPosting.update({
    where: { id },
    data: { applicationEntries: parsed.data.fields },
  })
  return NextResponse.json({ ok: true })
}
