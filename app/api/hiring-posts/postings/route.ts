import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { createPostingSchema } from '@/lib/validations/hiring-posts'
import { DEFAULT_FORM_FIELDS, listPostings, type PostingListStatus } from '@/lib/hiring/postings'

const VALID_STATUS = new Set(['DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED'])

// 공고 목록 (?status 필터)
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('hiring-posts')
  if ('error' in resolved) return resolved.error

  const statusParam = req.nextUrl.searchParams.get('status')
  const status =
    statusParam && VALID_STATUS.has(statusParam) ? (statusParam as PostingListStatus) : undefined

  const postings = await listPostings(resolved.space.id, status)
  return NextResponse.json({ postings })
}

// 새 공고 생성 (DRAFT) — 기본 제목·기본 폼으로 시작
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('hiring-posts')
  if ('error' in resolved) return resolved.error

  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const parsed = createPostingSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const posting = await prisma.hiringPosting.create({
    data: {
      spaceId: resolved.space.id,
      title: parsed.data.title?.trim() || '제목 없는 공고',
      status: 'DRAFT',
      authorUserId: resolved.user.id,
      applicationEntries: DEFAULT_FORM_FIELDS,
    },
    select: { id: true, uuid: true, title: true, status: true },
  })

  return NextResponse.json({ posting }, { status: 201 })
}
