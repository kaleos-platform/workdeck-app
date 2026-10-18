import { z } from 'zod'
import type { ActionDefinition } from './types'
import { prisma } from '@/lib/prisma'
import { requireDeck } from '@/lib/mcp/context'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { deploymentData, withSlugRetry } from '@/lib/sc/deployments'
import { httpUrl } from '@/lib/sc/schemas'
import { textToDoc } from '@/lib/sc/text-to-doc'

// 제네릭 파라미터 액션을 배열(ActionDefinition[])에 담기 위한 위더너(finance.ts와 동일 패턴).
function def<T>(d: ActionDefinition<T>): ActionDefinition {
  return d as unknown as ActionDefinition
}

export const postPublishParams = z.object({
  title: z.string().trim().min(1).max(200),
  // 텍스트 본문. `# `·`## `·`### ` 줄은 소제목이 된다.
  body: z.string().trim().min(50).max(50_000),
  channelId: z.string().min(1),
  targetUrl: httpUrl,
  scheduledAt: z.string().datetime().optional(),
  targetKeyword: z.string().trim().max(200).optional(),
})
export type PostPublishParams = z.infer<typeof postPublishParams>

async function activeChannel(spaceId: string, channelId: string) {
  const channel = await prisma.salesContentChannel.findFirst({
    where: { id: channelId, spaceId, isActive: true },
    select: { id: true, name: true, kind: true, platformSlug: true },
  })
  if (!channel) throw new ToolUserError('활성 채널을 찾을 수 없습니다(sc_list_channels 로 확인)')
  return channel
}

/**
 * 게시물 1건 = 승인 1회(2026-10-18 결정). 승인되면 콘텐츠(SCHEDULED)·배포를 만들고 발행 작업을 예약한다.
 * 구성원이 화면에서 쓰는 검수 흐름(IN_REVIEW→APPROVED)은 그대로 두고, 에이전트 제안만 이 경로를 탄다.
 */
const postPublish: ActionDefinition<PostPublishParams> = {
  actionType: 'sales-content.post.publish',
  deckKey: 'sales-content',
  title: '세일즈 콘텐츠 게시물 발행 예약',
  paramsSchema: postPublishParams,
  requiredRole: 'ADMIN',
  // 실행은 단일 트랜잭션(외부 호출 없음) — 실패하면 아무것도 남지 않아 같은 내용 재제안을 허용한다.
  retryableAfterFailure: true,
  validateCreate: async (ctx, params) => {
    await requireDeck(ctx.spaceId, 'sales-content')
    await activeChannel(ctx.spaceId, params.channelId)
  },
  execute: async (ctx, params) => {
    const { spaceId } = ctx
    // 승인과 실행 사이에 채널이 꺼지거나 지워졌을 수 있다.
    const channel = await activeChannel(spaceId, params.channelId)
    // 예약 시각이 지났으면(승인이 늦은 경우) 승인 시점에 바로 발행한다.
    const requested = params.scheduledAt ? new Date(params.scheduledAt) : null
    const scheduledAt = requested && requested > new Date() ? requested : new Date()

    // 콘텐츠·배포·발행 작업을 한 트랜잭션으로 만든다(실패 시 부분 행·고아 작업이 남지 않게).
    // 배포는 처음부터 PUBLISHING 으로 만든다 — SCHEDULED 로 만든 뒤 바꾸면 그 사이 배포 실행 API 가
    // claim 해 같은 배포에 PUBLISH 작업이 두 개 생길 수 있다.
    const created = await withSlugRetry(() =>
      prisma.$transaction(async (tx) => {
        const content = await tx.content.create({
          data: {
            spaceId,
            // User FK — 제안자가 에이전트일 수 있으므로 승인한 구성원으로 기록한다.
            userId: ctx.deciderId ?? null,
            title: params.title,
            body: params.body,
            doc: textToDoc(params.body) as never,
            status: 'SCHEDULED',
            scheduledAt,
            channelId: channel.id,
            targetKeyword: params.targetKeyword ?? null,
          },
          select: { id: true, title: true },
        })
        const deployment = await tx.contentDeployment.create({
          data: {
            ...deploymentData(spaceId, content, channel, {
              targetUrl: params.targetUrl,
              scheduledAt: scheduledAt.toISOString(),
            }),
            status: 'PUBLISHING',
          },
          select: { id: true },
        })
        // enqueueJob(lib/sc/jobs) 과 같은 행 — 트랜잭션 클라이언트로 직접 만든다.
        const job = await tx.salesContentJob.create({
          data: {
            spaceId,
            kind: 'PUBLISH',
            targetId: deployment.id,
            payload: { deploymentId: deployment.id },
            scheduledAt,
          },
          select: { id: true },
        })
        return { contentId: content.id, deploymentId: deployment.id, jobId: job.id }
      })
    )
    return { ...created, channel: channel.name, scheduledAt: scheduledAt.toISOString() }
  },
}

export const salesContentActions: ActionDefinition[] = [def(postPublish)]
