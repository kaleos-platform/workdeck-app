import { BROWSER_ROUNDTRIP_ACTION, roundtripParams } from '@/lib/browser/approved-write'
import { createPendingAction } from '@/lib/agent/actions/create'
import { idempotencyKeyFor } from './write-tools'
import type { ToolDefinition } from './types'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export const browserTools: ToolDefinition[] = [
  {
    name: 'browser_propose_cafe24_dev_check',
    description:
      'Cafe24 개발 스킨 /index.html에 고정 HTML 주석을 저장·재조회·원복하는 검증을 제안합니다. 사전 조회한 원본 해시가 필요하며 ADMIN의 웹 단건 승인 이후 등록된 Ego GPT worker만 실행합니다. 운영 디자인·임의 코드·로그인 제출은 지원하지 않습니다.',
    inputSchema: roundtripParams.shape,
    mode: 'write',
    scope: 'browser:write',
    async execute(ctx, input) {
      const params = roundtripParams.parse(input)
      return createPendingAction({
        spaceId: ctx.spaceId,
        actionType: BROWSER_ROUNDTRIP_ACTION,
        params,
        summary: `${params.mallId}/${params.skinCode}${params.file} 주석 저장·재조회·원복 (${params.markerId})`,
        source: 'MCP',
        actor: ctx.actor,
        requesterUserId: ctx.requesterUserId,
        requesterSlackUserId: ctx.requesterSlackUserId,
        workId: ctx.workId,
        actorTokenId: ctx.actorTokenId,
        idempotencyKey: idempotencyKeyFor(BROWSER_ROUNDTRIP_ACTION, ctx.spaceId, params),
      })
    },
  },
  {
    name: 'browser_get_write_job',
    description:
      '같은 Space의 승인된 Ego 브라우저 작업 결과를 조회합니다. 승인 접수와 실제 저장·복원 결과는 별개이며, 결과 불명 또는 실행 만료 후 RUNNING은 수동 확인 대상입니다.',
    inputSchema: { jobId: z.string().min(1).max(100) },
    mode: 'read',
    scope: 'browser:read',
    async execute(ctx, input) {
      const job = await prisma.browserWriteJob.findFirst({
        where: { id: z.string().parse(input.jobId), spaceId: ctx.spaceId },
        select: {
          id: true,
          actionId: true,
          status: true,
          expiresAt: true,
          claimedAt: true,
          finishedAt: true,
          report: true,
        },
      })
      return {
        job,
        requiresReview: Boolean(
          job &&
          (job.status === 'UNCERTAIN' ||
            (job.status === 'RUNNING' && job.expiresAt.getTime() < Date.now()))
        ),
      }
    },
  },
]
