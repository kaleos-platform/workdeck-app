/**
 * GET /api/finance/staging
 * 거래 내역 화면의 확인·처리 대기열 — DRAFT 임포트의 스테이징 행을 탭/계좌 필터로 조회 + 탭별 카운트.
 *
 * query: importId?(특정 임포트), accountId?, tab?(all|unclassified|review|dup|classified), take?, skip?
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { toNum, toNumOrNull } from '@/lib/finance/serialize'
import { loadRuleSuggestContext, ruleSuggestionFor } from '@/lib/finance/rule-suggest'
import type { Prisma } from '@/generated/prisma/client'

const DUP = ['DUP_SAME', 'DUP_CHANGED', 'DUP_OVERWRITE'] as const

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const sp = req.nextUrl.searchParams
  const importId = sp.get('importId') ?? undefined
  const accountId = sp.get('accountId') ?? undefined
  const tab = sp.get('tab') ?? 'all'
  const take = Math.min(500, Math.max(1, Number(sp.get('take') ?? 200)))
  const skip = Math.max(0, Number(sp.get('skip') ?? 0))

  // 기본 스코프: DRAFT 임포트의 스테이징 행
  const base: Prisma.FinStagedRowWhereInput = {
    spaceId,
    import: { status: 'DRAFT' },
    ...(importId ? { importId } : {}),
    ...(accountId ? { accountId } : {}),
  }

  // DUP_SAME(동일 중복 → 건너뜀)은 중복 탭 전용 — 활성 큐(전체/미분류/검토/분류완료)에는
  // 대표 행 한 벌만 보이도록 제외한다. DUP_CHANGED/DUP_OVERWRITE는 확정 대상이므로 유지.
  const activeQueue: Prisma.FinStagedRowWhereInput = { resolution: { not: 'DUP_SAME' } }

  const tabWhere: Prisma.FinStagedRowWhereInput = (() => {
    switch (tab) {
      case 'unclassified':
        return { classStatus: 'UNCLASSIFIED', ...activeQueue }
      case 'review':
        return { classStatus: 'REVIEW', ...activeQueue }
      case 'dup':
        return { resolution: { in: [...DUP] } }
      case 'classified':
        return { classStatus: 'CLASSIFIED', ...activeQueue }
      default:
        return activeQueue
    }
  })()

  const [rows, total, unclassified, review, dup, classified, cats] = await Promise.all([
    prisma.finStagedRow.findMany({
      where: { ...base, ...tabWhere },
      orderBy: { txnDate: 'asc' },
      take,
      skip,
      select: {
        id: true,
        importId: true,
        accountId: true,
        txnDate: true,
        direction: true,
        amount: true,
        balanceAfter: true,
        description: true,
        counterparty: true,
        memo: true,
        approvalNo: true,
        cancelFlag: true,
        classStatus: true,
        resolution: true,
        matchedRuleId: true,
        categoryId: true,
        category: { select: { id: true, name: true, parent: { select: { name: true } } } },
        account: { select: { id: true, name: true, kind: true } },
      },
    }),
    prisma.finStagedRow.count({ where: { ...base, ...activeQueue } }),
    prisma.finStagedRow.count({ where: { ...base, classStatus: 'UNCLASSIFIED', ...activeQueue } }),
    prisma.finStagedRow.count({ where: { ...base, classStatus: 'REVIEW', ...activeQueue } }),
    prisma.finStagedRow.count({ where: { ...base, resolution: { in: [...DUP] } } }),
    prisma.finStagedRow.count({ where: { ...base, classStatus: 'CLASSIFIED', ...activeQueue } }),
    prisma.finCategory.findMany({
      where: { spaceId, isActive: true },
      select: { id: true, name: true, type: true },
    }),
  ])

  // 룰(키워드) 추천을 미분류 행에 배치로 계산해 자동 표시(버튼 없이). AI는 클라이언트 버튼.
  const { ruleset, nameById } = await loadRuleSuggestContext(spaceId, cats)

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      amount: toNum(r.amount),
      balanceAfter: toNumOrNull(r.balanceAfter),
      ruleSuggestion:
        r.classStatus === 'UNCLASSIFIED'
          ? ruleSuggestionFor(
              { description: r.description, counterparty: r.counterparty },
              r.direction,
              ruleset,
              nameById
            )
          : null,
    })),
    counts: { total, unclassified, review, dup, classified },
  })
}
