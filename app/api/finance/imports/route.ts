/**
 * GET /api/finance/imports?[accountId=...&limit=50&offset=0]
 * 데이터 등록(업로드) 이력 목록 — 최신순.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const MAX_LIMIT = 200

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('accountId')
  const limit = Number(searchParams.get('limit') ?? 50)
  const offset = Number(searchParams.get('offset') ?? 0)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return errorResponse(`limit는 1~${MAX_LIMIT} 사이 정수여야 합니다`, 400)
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return errorResponse('offset은 0 이상 정수여야 합니다', 400)
  }

  const where = { spaceId, ...(accountId ? { accountId } : {}) }
  const [rows, total] = await Promise.all([
    prisma.finImport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        fileName: true,
        institution: true,
        kind: true,
        status: true,
        periodFrom: true,
        periodTo: true,
        totalRows: true,
        committedRows: true,
        createdAt: true,
        account: { select: { id: true, name: true, kind: true, institution: true } },
      },
    }),
    prisma.finImport.count({ where }),
  ])

  return NextResponse.json({
    total,
    imports: rows.map((r) => ({
      ...r,
      // txnDate 규약(KST 자릿수의 UTC 저장) — 날짜 표기는 클라이언트에서 UTC getter로
      periodFrom: r.periodFrom?.toISOString() ?? null,
      periodTo: r.periodTo?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  })
}
