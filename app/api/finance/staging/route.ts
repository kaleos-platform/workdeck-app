/**
 * GET /api/finance/staging
 * 거래 내역 화면의 확인·처리 대기열 — DRAFT 임포트의 스테이징 행을 탭/계좌 필터로 조회 + 탭별 카운트.
 *
 * query: importId?(특정 임포트), accountId?, tab?(all|unclassified|review|dup|classified), q?(적요·상대·메모), take?, skip?
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
  const q = sp.get('q')?.trim() || undefined
  const take = Math.min(500, Math.max(1, Number(sp.get('take') ?? 200)))
  const skip = Math.max(0, Number(sp.get('skip') ?? 0))

  // 기본 스코프: DRAFT 임포트의 스테이징 행
  const base: Prisma.FinStagedRowWhereInput = {
    spaceId,
    import: { status: 'DRAFT' },
    ...(importId ? { importId } : {}),
    ...(accountId ? { accountId } : {}),
    // 확정 거래 검색(queries.ts)과 같은 대상 — 적요·상대·메모. 탭 카운트에도 함께 반영한다.
    // tabWhere 에는 OR 절이 없어 스프레드 병합 시 키 충돌이 없다.
    ...(q
      ? {
          OR: [
            { description: { contains: q, mode: 'insensitive' as const } },
            { counterparty: { contains: q, mode: 'insensitive' as const } },
            { memo: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
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

  const [rows, total, unclassified, review, dup, dupTotal, classified, cats] = await Promise.all([
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
        identityKey: true,
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
    // 중복 배지 = 미결정(DUP_CHANGED)만 — 제외(DUP_SAME)/유지(DUP_OVERWRITE) 결정 시 감소
    prisma.finStagedRow.count({ where: { ...base, resolution: 'DUP_CHANGED' } }),
    prisma.finStagedRow.count({ where: { ...base, resolution: { in: [...DUP] } } }),
    prisma.finStagedRow.count({ where: { ...base, classStatus: 'CLASSIFIED', ...activeQueue } }),
    prisma.finCategory.findMany({
      where: { spaceId, isActive: true },
      select: { id: true, name: true, type: true },
    }),
  ])

  // 룰(키워드) 추천을 미분류 행에 배치로 계산해 자동 표시(버튼 없이). AI는 클라이언트 버튼.
  const { ruleset, nameById } = await loadRuleSuggestContext(spaceId, cats)

  // 중복(DUP_CHANGED/DUP_OVERWRITE) 행의 "변경 전" 값 — 재업로드가 확정 거래의 적요/상대를
  // 어떻게 바꾸는지 저장 전에 확인할 수 있어야 한다. DUP_SAME은 내용 동일이라 조회하지 않는다.
  const dupKeys = [
    ...new Set(
      rows
        .filter((r) => r.resolution === 'DUP_CHANGED' || r.resolution === 'DUP_OVERWRITE')
        .map((r) => r.identityKey)
    ),
  ]
  const prevByKey = new Map<string, { description: string | null; counterparty: string | null }>()
  if (dupKeys.length > 0) {
    const prior = await prisma.finTransaction.findMany({
      where: { spaceId, identityKey: { in: dupKeys } },
      select: { accountId: true, identityKey: true, description: true, counterparty: true },
    })
    for (const p of prior) {
      prevByKey.set(`${p.accountId}|${p.identityKey}`, {
        description: p.description,
        counterparty: p.counterparty,
      })
    }
  }

  return NextResponse.json({
    rows: rows.map(({ identityKey, ...r }) => ({
      ...r,
      /** 중복 행의 기존 확정 거래 값 — 없으면 null(신규이거나 다른 계좌) */
      prev: prevByKey.get(`${r.accountId}|${identityKey}`) ?? null,
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
    counts: { total, unclassified, review, dup, dupTotal, classified },
  })
}
