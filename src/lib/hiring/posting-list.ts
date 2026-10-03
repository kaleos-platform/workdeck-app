import { prisma } from '@/lib/prisma'
import type { PostingListStatus } from './postings'

const PAGE_SIZE = 50
const STATUSES = new Set(['DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED'])

export async function listPostingPage(
  spaceId: string,
  params: { q?: string | string[]; status?: string | string[]; page?: string | string[] }
) {
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 200) : ''
  const status: PostingListStatus | 'ALL' =
    typeof params.status === 'string' && STATUSES.has(params.status)
      ? (params.status as PostingListStatus)
      : 'ALL'
  const requestedPage =
    typeof params.page === 'string' && /^\d+$/.test(params.page) ? Number(params.page) : 1
  // Prisma skip의 Int 범위를 넘어서는 입력은 첫 페이지로 복구한다.
  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= Math.floor(2147483647 / PAGE_SIZE) + 1
      ? requestedPage
      : 1
  const where = {
    spaceId,
    ...(status !== 'ALL' ? { status } : {}),
    ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.hiringPosting.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        uuid: true,
        title: true,
        status: true,
        closingDate: true,
        createdAt: true,
        _count: { select: { applications: true } },
      },
    }),
    prisma.hiringPosting.count({ where }),
  ])
  return { rows, total, page, pageSize: PAGE_SIZE, q, status }
}
