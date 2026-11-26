import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { companyProfileSchema } from '@/lib/validations/hiring-posts'

const PROFILE_SELECT = {
  companyName: true,
  intro: true,
  homepageUrl: true,
  blogUrl: true,
  instagramUrl: true,
  youtubeUrl: true,
  showIntro: true,
} as const

// 기업 정보 조회 — 저장 전이면 profile=null, 입력란 기본값용 공간 이름을 함께 준다
export async function GET() {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error

  const profile = await prisma.hiringCompanyProfile.findUnique({
    where: { spaceId: resolved.space.id },
    select: PROFILE_SELECT,
  })
  return NextResponse.json({ profile, defaultCompanyName: resolved.space.name })
}

// 기업 정보 저장(공간당 1개 upsert). spaceId 는 항상 인증 컨텍스트에서만 가져온다.
export async function PUT(req: NextRequest) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = companyProfileSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('입력값을 확인해 주세요', 400, { errors: parsed.error.flatten() })
  }

  const profile = await prisma.hiringCompanyProfile.upsert({
    where: { spaceId: resolved.space.id },
    create: { spaceId: resolved.space.id, ...parsed.data },
    update: parsed.data,
    select: PROFILE_SELECT,
  })
  return NextResponse.json({ profile })
}
