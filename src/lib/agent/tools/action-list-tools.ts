import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { maskParams, maskSecrets } from '@/lib/agent/audit'
import type { Scope } from '@/lib/agent/identity/principal'
import type { ToolDefinition } from './types'

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED', 'EXPIRED'] as const

/**
 * 덱 하나의 승인 큐 제안을 조회하는 read 도구. 제안 → 승인 → 실행 결과(생성된 객체 id 포함)를 이어 볼 때 쓴다.
 * 조건은 항상 현재 Space + 덱이다(다른 Space·다른 덱 제안은 보이지 않는다). 비밀값은 감사 규칙으로 가린다.
 */
export function makeListActionsTool(opts: {
  name: string
  deckKey: string
  scope: Scope
  label: string
}): ToolDefinition {
  return {
    name: opts.name,
    description: `${opts.label} 제안(승인 대기 큐) 목록을 최신순으로 반환합니다. 상태(PENDING·APPROVED·REJECTED·EXECUTED·FAILED·EXPIRED), 제안 내용, 실행 결과(생성된 객체 id 포함), 실패 사유를 담습니다. 제안 직후 받은 actionId나 workId로 좁힐 수 있습니다.`,
    inputSchema: {
      status: z.enum(STATUSES).optional(),
      actionId: z.string().min(1).optional(),
      workId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    mode: 'read',
    scope: opts.scope,
    async execute(ctx, p) {
      const rows = await prisma.agentPendingAction.findMany({
        where: {
          ...(p.status ? { status: p.status as (typeof STATUSES)[number] } : {}),
          ...(p.actionId ? { id: p.actionId as string } : {}),
          ...(p.workId ? { workId: p.workId as string } : {}),
          spaceId: ctx.spaceId,
          deckKey: opts.deckKey,
        },
        orderBy: { createdAt: 'desc' },
        take: (p.limit as number | undefined) ?? 20,
        select: {
          id: true,
          actionType: true,
          status: true,
          summary: true,
          payload: true,
          result: true,
          error: true,
          workId: true,
          actorType: true,
          actorId: true,
          createdAt: true,
          expiresAt: true,
          decidedAt: true,
          executedAt: true,
        },
      })
      return {
        actions: rows.map((r) => ({
          ...r,
          summary: maskSecrets(r.summary),
          payload: maskParams(r.payload),
          result: r.result === null ? null : maskParams(r.result),
          error: r.error === null ? null : maskSecrets(r.error),
        })),
      }
    },
  }
}
