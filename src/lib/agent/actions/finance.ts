import { z } from 'zod'
import type { ActionDefinition } from './types'
import { prisma } from '@/lib/prisma'
import { learnRule } from '@/lib/finance/classify'
import { normalizeFinKey, directionForType } from '@/lib/finance/kifrs-seed'

// 제네릭 파라미터 액션을 배열(ActionDefinition[])에 담기 위한 위더너.
// TParams는 execute/snapshot에서 반공변 위치라 좁은 타입이 넓은 타입에 직접 대입 불가 →
// 정의 시점 타입 안전성은 유지하고 등록 시점에만 위젯한다.
function def<T>(d: ActionDefinition<T>): ActionDefinition {
  return d as unknown as ActionDefinition
}

// ─── 1) finance.transaction.reclassify ──────────────────────────────────────
// 재사용: app/api/finance/transactions/[id]/route.ts PATCH 로직(categoryId 검증 →
//   classStatus=CLASSIFIED · isTransfer=category.type==='TRANSFER' → learn!==false면
//   learnRule → update). route 핸들러/NextResponse 벗기고 spaceId 우선 순수 도메인.
const reclassifyParams = z.object({
  transactionId: z.string(),
  categoryId: z.string(),
  learn: z.boolean().optional(),
})

const reclassify: ActionDefinition<z.infer<typeof reclassifyParams>> = {
  actionType: 'finance.transaction.reclassify',
  deckKey: 'finance',
  title: '거래 재분류',
  paramsSchema: reclassifyParams,
  requiredRole: 'ADMIN',
  // 실행 전 상태 스냅샷 — diff·감사용. 실패해도 액션 생성은 진행되므로 관대하게(없으면 null).
  snapshot: async (ctx, params) => {
    const txn = await prisma.finTransaction.findFirst({
      where: { id: params.transactionId, spaceId: ctx.spaceId },
      select: { categoryId: true, classStatus: true },
    })
    return txn ?? null
  },
  execute: async (ctx, params) => {
    const spaceId = ctx.spaceId
    // 소유 검증 — learnRule 4번째 인자(direction)가 non-null이라 direction까지 로드.
    const txn = await prisma.finTransaction.findFirst({
      where: { id: params.transactionId, spaceId },
      select: { id: true, description: true, counterparty: true, direction: true },
    })
    if (!txn) throw new Error('거래를 찾을 수 없습니다')

    const category = await prisma.finCategory.findFirst({
      where: { id: params.categoryId, spaceId },
      select: { id: true, type: true },
    })
    if (!category) throw new Error('계정과목을 찾을 수 없습니다')

    let matchedRuleId: string | null | undefined
    if (params.learn !== false) {
      matchedRuleId = await learnRule(
        spaceId,
        { description: txn.description, counterparty: txn.counterparty },
        params.categoryId,
        txn.direction
      )
    }

    await prisma.finTransaction.update({
      where: { id: txn.id },
      data: {
        categoryId: params.categoryId,
        classStatus: 'CLASSIFIED',
        isTransfer: category.type === 'TRANSFER',
        ...(matchedRuleId !== undefined ? { matchedRuleId } : {}),
      },
    })

    return { transactionId: txn.id, categoryId: params.categoryId, classStatus: 'CLASSIFIED' }
  },
}

// ─── 2) finance.classrule.create ────────────────────────────────────────────
// 재사용: app/api/finance/rules/route.ts POST 로직(normalizeFinKey, directionForType,
//   findFirst → update/create, learnedFrom='USER').
const classruleParams = z.object({
  matchKey: z.string().min(1),
  categoryId: z.string(),
  matchType: z.enum(['EXACT', 'KEYWORD']),
})

const classruleCreate: ActionDefinition<z.infer<typeof classruleParams>> = {
  actionType: 'finance.classrule.create',
  deckKey: 'finance',
  title: '분류 규칙 추가',
  paramsSchema: classruleParams,
  requiredRole: 'ADMIN',
  execute: async (ctx, params) => {
    const spaceId = ctx.spaceId

    const category = await prisma.finCategory.findFirst({
      where: { id: params.categoryId, spaceId },
      select: { id: true, type: true },
    })
    if (!category) throw new Error('계정과목을 찾을 수 없습니다')

    const normalizedKey = normalizeFinKey(params.matchKey)
    const direction = directionForType(category.type)

    // (spaceId, matchKey, direction) 멱등 — direction이 null일 수 있어 findFirst → update/create.
    const existing = await prisma.finClassRule.findFirst({
      where: { spaceId, matchKey: normalizedKey, direction },
      select: { id: true },
    })
    const created = !existing
    const rule = existing
      ? await prisma.finClassRule.update({
          where: { id: existing.id },
          data: { categoryId: params.categoryId, matchType: params.matchType, learnedFrom: 'USER' },
          select: { id: true },
        })
      : await prisma.finClassRule.create({
          data: {
            spaceId,
            matchKey: normalizedKey,
            categoryId: params.categoryId,
            matchType: params.matchType,
            learnedFrom: 'USER',
            direction,
          },
          select: { id: true },
        })

    return { ruleId: rule.id, created }
  },
}

// finance deck 승인 큐 액션.
export const financeActions: ActionDefinition[] = [def(reclassify), def(classruleCreate)]
