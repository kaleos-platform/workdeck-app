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
import { getAppOrigin } from '@/lib/domain'
import { buildPublishSnapshot, photoSlots, readAsideConfig } from '@/lib/sc/aside-publish'
import { notifyDeploymentThread } from '@/lib/sc/deployment-notify'
import { saveAssetPlan } from '@/lib/sc/asset-plan'

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
  // 자동 게시(Aside) 채널에서 쓰는 블로그 카테고리·태그. 없으면 채널 기본 카테고리.
  category: z.string().trim().min(1).max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(30).optional(),
  // OSMU: 노션 발행 요청(ScPublishRequest) 에서 온 제안이면 그 id. 승인 시 콘텐츠와 1:1 로 연결된다.
  requestId: z.string().min(1).max(100).optional(),
  // 사진 자리(본문 `[사진: …]` 순서, 1부터) ← 소재 사진. copyId 는 제안 시점 storage 복사본(서버가 채움).
  photos: z
    .array(
      z.object({
        slot: z.number().int().min(1).max(50),
        mediaId: z.string().min(1).max(100),
        copyId: z.string().min(1).max(100),
      })
    )
    .max(50)
    .optional(),
})
export type PostPublishParams = z.infer<typeof postPublishParams>

/** 요청 연결 제안의 사전 검증: 같은 Space·작성/제안 단계·미연결, 사진 복사본은 그 요청 것만. */
async function checkRequest(spaceId: string, params: PostPublishParams) {
  if (params.photos?.length && !params.requestId) {
    throw new ToolUserError('photos 는 requestId(발행 요청)와 함께만 쓸 수 있습니다')
  }
  if (!params.requestId) return
  const request = await prisma.scPublishRequest.findFirst({
    where: { id: params.requestId, spaceId },
    select: { state: true, contentId: true },
  })
  if (!request) throw new ToolUserError('발행 요청을 찾을 수 없습니다(sc_list_requests 로 확인)')
  if (request.contentId || (request.state !== 'READY' && request.state !== 'PROPOSED')) {
    throw new ToolUserError('작성 대기 상태의 발행 요청이 아닙니다')
  }
  const copyIds = (params.photos ?? []).map((p) => p.copyId)
  if (copyIds.length) {
    const copies = await prisma.scMediaCopy.findMany({
      where: { id: { in: copyIds }, spaceId, requestId: params.requestId },
      select: { id: true, mediaId: true },
    })
    const ok = new Map(copies.map((c) => [c.id, c.mediaId]))
    if (params.photos!.some((p) => ok.get(p.copyId) !== p.mediaId)) {
      throw new ToolUserError('사진 복사본이 이 요청의 것이 아닙니다')
    }
  }
}

async function activeChannel(spaceId: string, channelId: string) {
  const channel = await prisma.salesContentChannel.findFirst({
    where: { id: channelId, spaceId, isActive: true },
    select: {
      id: true,
      name: true,
      kind: true,
      platformSlug: true,
      publisherMode: true,
      config: true,
    },
  })
  if (!channel) throw new ToolUserError('활성 채널을 찾을 수 없습니다(sc_list_channels 로 확인)')
  return channel
}

/**
 * 게시물 1건 = 승인 1회(2026-10-18 결정). 승인되면 콘텐츠(SCHEDULED)·배포를 만들고 발행 작업을 예약한다.
 * 구성원이 화면에서 쓰는 검수 흐름(IN_REVIEW→APPROVED)은 그대로 두고, 에이전트 제안만 이 경로를 탄다.
 */
const postPublish: ActionDefinition<PostPublishParams> = {
  // Slack 승인 알림은 값을 300자에서 자른다 — 그보다 긴 본문은 전문을 볼 수 있는 웹에서만 승인한다.
  // 소재·사진 기반 제안은 썸네일·근거를 봐야 하므로 길이와 무관하게 웹 승인.
  requiresWebReview: (params) =>
    params.body.length > 300 || !!params.requestId || !!params.photos?.length,
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
    await checkRequest(ctx.spaceId, params)
  },
  execute: async (ctx, params) => {
    const { spaceId } = ctx
    // 승인과 실행 사이에 채널이 꺼지거나 지워졌을 수 있다.
    const channel = await activeChannel(spaceId, params.channelId)
    // 예약 시각이 지났으면(승인이 늦은 경우) 승인 시점에 바로 발행한다.
    const requested = params.scheduledAt ? new Date(params.scheduledAt) : null
    const scheduledAt = requested && requested > new Date() ? requested : new Date()
    const doc = textToDoc(params.body)
    const aside = channel.publisherMode === 'ASIDE' ? readAsideConfig(channel.config) : null
    // 승인 알림 메시지 스레드 — 사진 요청·게시 결과를 여기에 이어 단다.
    const approval = ctx.actionId
      ? await prisma.agentPendingAction.findUnique({
          where: { id: ctx.actionId },
          select: { slackChannelId: true, slackMessageTs: true },
        })
      : null

    // 콘텐츠·배포·발행 작업을 한 트랜잭션으로 만든다(실패 시 부분 행·고아 작업이 남지 않게).
    // 배포는 처음부터 PUBLISHING 으로 만든다 — SCHEDULED 로 만든 뒤 바꾸면 그 사이 배포 실행 API 가
    // claim 해 같은 배포에 PUBLISH 작업이 두 개 생길 수 있다.
    const created = await withSlugRetry(() =>
      prisma.$transaction(async (tx) => {
        // 요청 연결: 행을 잠가 같은 요청이 두 번 승인돼 콘텐츠가 둘 생기지 않게 한다.
        let sourceVersionId: string | null = null
        if (params.requestId) {
          const locked = await tx.$queryRaw<
            { contentId: string | null; state: string; sourceVersionId: string | null }[]
          >`
            SELECT "contentId", "state"::text AS "state", "sourceVersionId" FROM "ScPublishRequest"
            WHERE "id" = ${params.requestId} AND "spaceId" = ${spaceId} FOR UPDATE`
          const r = locked[0]
          if (!r) throw new ToolUserError('발행 요청을 찾을 수 없습니다')
          if (r.contentId) throw new ToolUserError('이미 승인된 발행 요청입니다')
          // 제안 이후 요청이 취소·재시작됐으면 이 제안은 낡은 것이다.
          if (r.state !== 'PROPOSED') {
            throw new ToolUserError('승인 대기 상태의 발행 요청이 아닙니다(취소·재요청됨)')
          }
          sourceVersionId = r.sourceVersionId
        }
        const content = await tx.content.create({
          data: {
            spaceId,
            // User FK — 제안자가 에이전트일 수 있으므로 승인한 구성원으로 기록한다.
            userId: ctx.deciderId ?? null,
            title: params.title,
            body: params.body,
            doc: doc as never,
            status: 'SCHEDULED',
            scheduledAt,
            channelId: channel.id,
            targetKeyword: params.targetKeyword ?? null,
            sourceVersionId,
          },
          select: { id: true, title: true },
        })
        if (params.requestId) {
          await tx.scPublishRequest.update({
            where: { id: params.requestId },
            data: { contentId: content.id, state: 'APPROVED', lastError: null },
          })
        }
        const data = deploymentData(spaceId, content, channel, {
          targetUrl: params.targetUrl,
          scheduledAt: scheduledAt.toISOString(),
        })
        // Aside 채널은 승인본을 배포에 고정한다. 사진 자리가 있으면 사람이 채울 때까지 발행 작업을 만들지 않는다.
        const snapshot = aside
          ? buildPublishSnapshot({
              title: params.title,
              doc,
              deploymentUrl: `${getAppOrigin()}/c/${data.shortSlug}`,
              category: params.category ?? aside.defaultCategory ?? null,
              tags: params.tags,
              autoPublish: aside.autoPublish,
            })
          : null
        const slots = snapshot ? photoSlots(snapshot) : []
        const awaitingAssets = slots.length > 0
        // 제안 때 고른 소재 사진(storage 복사본)을 이 콘텐츠의 에셋으로 만들고 자리를 미리 채운다.
        const prefilled = new Map<number, string>()
        if (awaitingAssets && params.photos?.length) {
          const copies = await tx.scMediaCopy.findMany({
            where: {
              id: { in: params.photos.map((p) => p.copyId) },
              spaceId,
              requestId: params.requestId,
            },
          })
          const byId = new Map(copies.map((c) => [c.id, c]))
          const valid = new Set(slots.map((s) => s.index))
          for (const p of params.photos) {
            const c = byId.get(p.copyId)
            if (!c || !valid.has(p.slot - 1) || prefilled.has(p.slot - 1)) continue
            const asset = await tx.contentAsset.create({
              data: {
                spaceId,
                contentId: content.id,
                kind: 'IMAGE',
                url: c.url,
                storagePath: c.storagePath,
                mimeType: c.mimeType,
                width: c.width,
                height: c.height,
              },
              select: { id: true },
            })
            prefilled.set(p.slot - 1, asset.id)
          }
        }
        const deployment = await tx.contentDeployment.create({
          data: {
            ...data,
            status: awaitingAssets ? 'AWAITING_ASSETS' : 'PUBLISHING',
            publishSnapshot: (snapshot ?? undefined) as never,
            assetPlan: awaitingAssets
              ? ({
                  slots: slots.map((s) => ({ index: s.index, assetId: prefilled.get(s.index) })),
                } as never)
              : undefined,
            notifySlackChannelId: approval?.slackChannelId ?? null,
            notifySlackThreadTs: approval?.slackMessageTs ?? null,
          },
          select: { id: true },
        })
        if (awaitingAssets) {
          return {
            contentId: content.id,
            deploymentId: deployment.id,
            jobId: null as string | null,
            photoSlots: slots.length,
            allPrefilled: prefilled.size === slots.length,
          }
        }
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
        return {
          contentId: content.id,
          deploymentId: deployment.id,
          jobId: job.id,
          photoSlots: 0,
          allPrefilled: false,
        }
      })
    )
    // 제안 사진으로 모든 자리가 찼으면 사람 손 없이 기존 완료 경로(발행 작업 생성)로 넘긴다.
    if (created.photoSlots > 0 && created.allPrefilled) {
      const plan = await prisma.contentDeployment.findUnique({
        where: { id: created.deploymentId },
        select: { assetPlan: true },
      })
      // 트랜잭션은 이미 커밋됨 — 여기서 실패해도 사진은 미리 채워져 있으니 사람 완료 경로(알림)로 넘긴다.
      const done = await saveAssetPlan({
        spaceId,
        deploymentId: created.deploymentId,
        plan: plan!.assetPlan as never,
        complete: true,
      }).catch(() => ({ ok: false as const }))
      if (done.ok) {
        return {
          ...created,
          jobId: done.jobId ?? null,
          channel: channel.name,
          scheduledAt: scheduledAt.toISOString(),
        }
      }
    }
    if (created.photoSlots > 0) {
      await notifyDeploymentThread(created.deploymentId, {
        kind: 'assets-needed',
        contentId: created.contentId,
        slots: created.photoSlots,
      })
    }
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
 * 채널은 같은 slug 가 있으면 그대로 둔다. 상품은 같은 브랜드에 같은 이름이 있으면 새로 만들지 않고
 * 넘긴 설명(oneLinerPitch·customFields)만 보충한다. 프로필도 넘긴 필드만 덮어쓴다 — 실행 전 값을 snapshot 으로 남긴다.
 */
const setupApply: ActionDefinition<SetupApplyParams> = {
  actionType: 'sales-content.setup.apply',
  deckKey: 'sales-content',
  title: '세일즈 콘텐츠 채널·브랜드 프로필·상품 등록·보충',
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
    products: params.products?.length
      ? await prisma.product.findMany({
          where: {
            spaceId: ctx.spaceId,
            brandId: params.brandId,
            name: { in: params.products.map((p) => p.name) },
          },
          select: { name: true, oneLinerPitch: true, customFields: true },
        })
      : [],
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
        // 이미 있는 상품은 넘긴 설명만 보충한다(빠진 필드·빈 customFields = 기존 값 유지).
        // 같은 이름 행이 여럿이면 같은 상품으로 보고 함께 갱신한다.
        let updated = 0
        for (const p of products) {
          const customFields = p.customFields?.length ? p.customFields : undefined
          if (!taken.has(p.name) || (p.oneLinerPitch === undefined && !customFields)) continue
          const r = await tx.product.updateMany({
            where: { spaceId, brandId, name: p.name },
            data: { oneLinerPitch: p.oneLinerPitch, customFields: customFields as never },
          })
          updated += r.count
        }
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
        result.products = { created: fresh.length, updated }
      }
      return result
    })
  },
}

export const salesContentActions: ActionDefinition[] = [def(postPublish), def(setupApply)]
