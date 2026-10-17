import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { maskParams, maskSecrets } from '@/lib/agent/audit'
import type { Scope } from '@/lib/agent/identity/principal'
import type { ToolDefinition } from './types'

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED', 'EXPIRED'] as const
// 승인 대기(PENDING)·실행 중(APPROVED) — waitSec 은 이 상태를 벗어날 때까지 기다린다.
const IN_FLIGHT = new Set(['PENDING', 'APPROVED'])
// MCP 함수 maxDuration(60초) 안에서 끝나도록 한 번 호출의 대기 상한을 둔다. 더 기다리려면 다시 호출한다.
export const MAX_WAIT_SEC = 45
const POLL_MS = 3000

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
    description: `${opts.label} 제안(승인 대기 큐) 목록을 최신순으로 반환합니다. 상태(PENDING·APPROVED·REJECTED·EXECUTED·FAILED·EXPIRED), 제안 내용, 실행 결과(생성된 객체 id 포함), 실패·거절 사유(error)를 담습니다. 제안 직후 받은 actionId나 workId로 좁힐 수 있습니다. actionId와 waitSec(최대 ${MAX_WAIT_SEC}초)을 주면 승인·실행이 끝날 때까지 기다렸다 결과를 돌려줍니다 — 승인 링크를 사용자에게 보여 준 뒤 호출하고, 응답의 waiting 이 true 면 다시 호출하세요.`,
    inputSchema: {
      status: z.enum(STATUSES).optional(),
      actionId: z.string().min(1).optional(),
      workId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      waitSec: z.number().int().min(1).max(MAX_WAIT_SEC).optional(),
    },
    mode: 'read',
    scope: opts.scope,
    async execute(ctx, p) {
      const query = () =>
        prisma.agentPendingAction.findMany({
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
      let rows = await query()
      let waiting = false
      const waitSec = p.waitSec as number | undefined
      if (waitSec && p.actionId) {
        // 승인은 사람이 웹·Slack에서 한다 — 여기서는 상태가 바뀌기를 기다리기만 한다(승인 권한 없음).
        const deadline = Date.now() + waitSec * 1000
        while (rows.some((r) => IN_FLIGHT.has(r.status)) && Date.now() + POLL_MS <= deadline) {
          await new Promise((r) => setTimeout(r, POLL_MS))
          rows = await query()
        }
        waiting = rows.some((r) => IN_FLIGHT.has(r.status))
      }
      return {
        ...(waitSec && p.actionId ? { waiting } : {}),
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
