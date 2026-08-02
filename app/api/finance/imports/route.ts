/**
 * GET /api/finance/imports?[accountId=...&limit=50&offset=0&includeCommitted=1]
 * 데이터 등록(업로드) 이력 목록 — 최신순.
 * 저장됨(committed) = 잔여 스테이징 행 0(모든 행이 확정/정리됨). status 컬럼 대신
 * 잔여 행 수로 파생하므로 과거 백로그도 일관되게 저장됨으로 분류된다.
 * 기본은 검토중(잔여 행 있음)만 반환, includeCommitted=1이면 전체.
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

  const includeCommitted = searchParams.get('includeCommitted') === '1'
  // 저장됨 숨김 = 잔여 스테이징 행이 있는 import만(관계 필터). includeCommitted 시 전체.
  const where = {
    spaceId,
    ...(accountId ? { accountId } : {}),
    ...(includeCommitted ? {} : { stagedRows: { some: {} } }),
  }
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
        _count: { select: { stagedRows: true } },
      },
    }),
    prisma.finImport.count({ where }),
  ])

  return NextResponse.json({
    total,
    imports: rows.map(({ _count, ...r }) => {
      const pending = _count.stagedRows
      const committed = pending === 0
      return {
        ...r,
        // 파생: 저장됨 = 잔여 스테이징 행 0. 확정 행수도 잔여로 역산(부분 커밋 중간값 반영).
        committed,
        committedRows: committed ? r.totalRows : Math.max(0, r.totalRows - pending),
        // txnDate 규약(KST 자릿수의 UTC 저장) — 날짜 표기는 클라이언트에서 UTC getter로
        periodFrom: r.periodFrom?.toISOString() ?? null,
        periodTo: r.periodTo?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }
    }),
  })
}
