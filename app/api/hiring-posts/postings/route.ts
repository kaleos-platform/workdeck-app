import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { createPostingSchema } from '@/lib/validations/hiring-posts'
import { DEFAULT_FORM_FIELDS, listPostings, type PostingListStatus } from '@/lib/hiring/postings'

const VALID_STATUS = new Set(['DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED'])

// 공고 목록 (?status 필터)
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error

  const statusParam = req.nextUrl.searchParams.get('status')
  const status =
    statusParam && VALID_STATUS.has(statusParam) ? (statusParam as PostingListStatus) : undefined

  const postings = await listPostings(resolved.space.id, status)
  return NextResponse.json({ postings })
}

// 새 공고 생성 (DRAFT) — 기본 제목·기본 폼으로 시작
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('recruiting')
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

  const title = parsed.data.title?.trim() || '제목 없는 공고'

  // 지원서 마감일 기본값: KST 기준 오늘 + 14일 (UTC 자정 DateTime — PATCH의 'YYYY-MM-DD' 저장과 동일 규약)
  const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  const defaultClosing = new Date(`${todayKst}T00:00:00Z`)
  defaultClosing.setUTCDate(defaultClosing.getUTCDate() + 14)

  const posting = await prisma.$transaction(async (tx) => {
    const created = await tx.hiringPosting.create({
      data: {
        spaceId: resolved.space.id,
        title,
        status: 'DRAFT',
        authorUserId: resolved.user.id,
        applicationEntries: DEFAULT_FORM_FIELDS,
        closingDate: defaultClosing,
      },
      select: { id: true, uuid: true, title: true, status: true },
    })

    // 기본 블록 시드: 제목 텍스트 블록(sortOrder 0) + 직무 정보 블록(sortOrder 1)
    const titleDoc = title
      ? {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: title }] },
          ],
        }
      : { type: 'doc', content: [] }

    await tx.hiringContent.create({
      data: {
        spaceId: resolved.space.id,
        postingId: created.id,
        sourceType: 'POSTING_DETAIL',
        contentType: 'text',
        sortOrder: 0,
        data: titleDoc,
      },
    })
    await tx.hiringContent.create({
      data: {
        spaceId: resolved.space.id,
        postingId: created.id,
        sourceType: 'POSTING_DETAIL',
        contentType: 'positions',
        sortOrder: 1,
      },
    })

    return created
  })

  return NextResponse.json({ posting }, { status: 201 })
}
