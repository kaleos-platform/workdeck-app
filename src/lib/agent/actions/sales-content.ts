import { z } from 'zod'
import type { ActionDefinition } from './types'
import { prisma } from '@/lib/prisma'
import { requireDeck } from '@/lib/mcp/context'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { deploymentData, withSlugRetry } from '@/lib/sc/deployments'
import {
  brandProfileSchema,
  httpUrl,
  productSchema,
  salesContentChannelInputSchema,
} from '@/lib/sc/schemas'
import { isSpaceBrand, saveBrandProfile } from '@/lib/sc/brand-profile'
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

export const setupApplyFields = z.object({
  // 대상 브랜드(seller-hub Brand id). 프로필·상품이 이 브랜드에 붙는다.
  brandId: z.string().min(1).max(100),
  // 발행 방식은 수동 고정 — 자동 발행(API·BROWSER)은 자격증명이 필요해 화면에서만 켠다.
  channel: salesContentChannelInputSchema
    .pick({ name: true, platformSlug: true, platform: true, kind: true })
    .optional(),
  profile: brandProfileSchema.optional(),
  products: z
    .array(productSchema.pick({ name: true, oneLinerPitch: true, customFields: true }))
    .max(30)
    .optional(),
})
// 도구 입력(sc_propose_setup)이 brandId 를 brand 로 바꿔 쓰도록 필드와 검증을 나눈다.
export const setupApplyParams = setupApplyFields.refine(
  (p) => p.channel || p.profile || p.products?.length,
  {
    message: 'channel·profile·products 중 하나 이상 필요합니다',
  }
)
export type SetupApplyParams = z.infer<typeof setupApplyParams>

async function requireSpaceBrand(spaceId: string, brandId: string) {
  if (!(await isSpaceBrand(spaceId, brandId))) {
    throw new ToolUserError('브랜드를 찾을 수 없습니다(sc_list_brands 로 확인)')
  }
}

/**
 * 브랜드 1개의 세일즈 콘텐츠 기초 데이터(채널·브랜드 프로필·상품)를 승인 1회로 등록한다.
 * 채널은 같은 slug 가 있으면 그대로 두고, 상품은 같은 브랜드에 같은 이름이 있으면 건너뛴다(재제안 안전).
 * 프로필은 넘긴 필드만 덮어쓴다 — 실행 전 프로필을 snapshot 으로 남긴다.
 */
const setupApply: ActionDefinition<SetupApplyParams> = {
  actionType: 'sales-content.setup.apply',
  deckKey: 'sales-content',
  title: '세일즈 콘텐츠 채널·브랜드 프로필·상품 등록',
  paramsSchema: setupApplyParams,
  requiredRole: 'ADMIN',
  retryableAfterFailure: true,
  validateCreate: async (ctx, params) => {
    await requireDeck(ctx.spaceId, 'sales-content')
    await requireSpaceBrand(ctx.spaceId, params.brandId)
  },
  snapshot: async (ctx, params) => ({
    profile: await prisma.brandProfile.findFirst({
      where: { spaceId: ctx.spaceId, brandId: params.brandId },
      select: { companyName: true, shortDescription: true, toneOfVoice: true, customFields: true },
    }),
  }),
  execute: async (ctx, params) => {
    const { spaceId } = ctx
    const { brandId, channel, profile, products } = params
    await requireSpaceBrand(spaceId, brandId)

    return prisma.$transaction(async (tx) => {
      const result: Record<string, unknown> = {}
      if (channel) {
        const ch = await tx.salesContentChannel.upsert({
          where: { spaceId_platformSlug: { spaceId, platformSlug: channel.platformSlug } },
          create: { spaceId, ...channel, publisherMode: 'MANUAL', collectorMode: 'MANUAL' },
          update: {},
          select: { id: true, name: true, isActive: true },
        })
        result.channel = { id: ch.id, name: ch.name, isActive: ch.isActive }
      }
      if (profile) {
        await saveBrandProfile(tx, spaceId, brandId, {
          companyName: profile.companyName,
          // 빠진 필드는 기존 값을 유지한다(undefined = Prisma 미변경).
          shortDescription: profile.shortDescription,
          toneOfVoice: profile.toneOfVoice,
          customFields: profile.customFields as never,
        })
        result.profile = 'saved'
      }
      if (products?.length) {
        // Product 에 (brandId, name) unique 가 없다 — 같은 브랜드 제안 동시 승인이 같은 상품을 두 번 만들지 않게.
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`sc-setup-products:${brandId}`}))`
        const existing = await tx.product.findMany({
          where: { spaceId, brandId, name: { in: products.map((p) => p.name) } },
          select: { name: true },
        })
        const taken = new Set(existing.map((p) => p.name))
        // 목록 안의 중복 이름도 한 번만 만든다.
        const fresh = products.filter((p) => !taken.has(p.name) && taken.add(p.name))
        await tx.product.createMany({
          data: fresh.map((p) => ({
            spaceId,
            brandId,
            name: p.name,
            oneLinerPitch: p.oneLinerPitch ?? null,
            customFields: (p.customFields ?? []) as never,
          })),
        })
        result.products = { created: fresh.length, skipped: products.length - fresh.length }
      }
      return result
    })
  },
}

export const salesContentActions: ActionDefinition[] = [def(postPublish), def(setupApply)]
