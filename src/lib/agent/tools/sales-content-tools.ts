import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireDeck } from '@/lib/mcp/context'
import { createPendingAction } from '@/lib/agent/actions/create'
import {
  postPublishParams,
  setupApplyFields,
  setupApplyParams,
} from '@/lib/agent/actions/sales-content'
import { idempotencyKeyFor } from './write-tools'
import { pickDailyMetrics } from '@/lib/sc/metrics-dedup'
import { redactErrorMessage } from '@/lib/sc/notifications'
import { ToolUserError } from './errors'
import type { ToolDefinition } from './types'

const DECK = 'sales-content'
const BODY_PREVIEW = 300

/**
 * 세일즈 콘텐츠 Deck 조회(read) tool. 에이전트가 브랜드별 콘텐츠 초안을 만들 재료를 읽는다.
 * 쓰기는 sc:write 제안 도구(승인 큐)로만 한다.
 * 채널 자격증명·config 는 돌려주지 않는다(연결 여부만).
 *
 * 관계 FK 는 Space 일치를 강제하지 않는다(다른 Space 채널을 가리키는 콘텐츠가 만들어질 수 있음).
 * 그래서 중첩 관계도 Space 를 다시 확인한다 — to-many 는 where, to-one 은 own() 으로 걸러낸다.
 */

/** to-one 관계가 같은 Space 일 때만 돌려준다(spaceId 는 응답에서 뺀다). */
function own<T extends { spaceId: string }>(spaceId: string, rel: T | null) {
  if (!rel) return null
  const { spaceId: relSpaceId, ...rest } = rel
  return relSpaceId === spaceId ? rest : null
}

const channelSelect = { id: true, name: true, platform: true, spaceId: true } as const

const brandParam = z
  .string()
  .optional()
  .describe('브랜드 이름 또는 id(sc_list_brands 결과). 없으면 전체')

/**
 * 브랜드 id·이름 → id. id 일치를 먼저 본다(어떤 브랜드 이름이 다른 브랜드 id 와 같아도 결정적).
 * 모르는 브랜드면 목록을 보라고 알린다.
 */
async function resolveBrandId(spaceId: string, brand: string | undefined) {
  if (!brand) return undefined
  const found =
    (await prisma.brand.findFirst({ where: { spaceId, id: brand }, select: { id: true } })) ??
    (await prisma.brand.findFirst({ where: { spaceId, name: brand }, select: { id: true } }))
  if (!found) throw new ToolUserError(`알 수 없는 브랜드: ${brand} (sc_list_brands 로 확인)`)
  return found.id
}

const profileSelect = {
  companyName: true,
  shortDescription: true,
  toneOfVoice: true,
  customFields: true,
  logoUrl: true,
} as const

const listBrands: ToolDefinition = {
  name: 'sc_list_brands',
  description:
    '브랜드 목록과 브랜드별 콘텐츠 프로필(회사명·한 줄 소개·톤·커스텀 필드)을 반환합니다. profile 이 null 인 브랜드는 공통 프로필(commonProfile)을 씁니다. 블로그·SNS 게시물(초안 포함)을 요청받으면 직접 쓰기 전에 이 도구 → sc_list_products → sc_list_channels 순으로 브랜드 톤·상품 사실·채널을 확인하고, 완성한 글은 대화에 붙이지 말고 sc_propose_post 로 승인 대기에 올리세요.',
  inputSchema: {},
  mode: 'read',
  scope: 'sc:read',
  async execute(ctx) {
    await requireDeck(ctx.spaceId, DECK)
    const [brands, profiles] = await Promise.all([
      prisma.brand.findMany({
        where: { spaceId: ctx.spaceId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      prisma.brandProfile.findMany({
        where: { spaceId: ctx.spaceId },
        select: { brandId: true, ...profileSelect },
      }),
    ])
    const byBrand = new Map(profiles.map(({ brandId, ...p }) => [brandId, p]))
    return {
      brands: brands.map((b) => ({ ...b, profile: byBrand.get(b.id) ?? null })),
      commonProfile: byBrand.get(null) ?? null,
    }
  },
}

const listProducts: ToolDefinition = {
  name: 'sc_list_products',
  description:
    '세일즈 콘텐츠 상품 목록(이름·한 줄 소개·브랜드·커스텀 필드·연결된 페르소나)을 반환합니다. brand 로 좁힐 수 있고, 기본은 활성 상품만입니다.',
  inputSchema: {
    brand: brandParam,
    includeInactive: z.boolean().optional(),
  },
  mode: 'read',
  scope: 'sc:read',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    const brandId = await resolveBrandId(ctx.spaceId, params.brand as string | undefined)
    const products = await prisma.product.findMany({
      where: {
        spaceId: ctx.spaceId,
        ...(brandId && { brandId }),
        ...(!params.includeInactive && { isActive: true }),
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        oneLinerPitch: true,
        customFields: true,
        isActive: true,
        brand: { select: { id: true, name: true, spaceId: true } },
        personas: {
          where: { persona: { spaceId: ctx.spaceId } },
          select: { persona: { select: { id: true, name: true } } },
        },
      },
    })
    return {
      products: products.map(({ personas, brand, ...p }) => ({
        ...p,
        brand: own(ctx.spaceId, brand),
        personas: personas.map((x) => x.persona),
      })),
    }
  },
}

const listPersonas: ToolDefinition = {
  name: 'sc_list_personas',
  description: '타깃 페르소나 목록(이름·직무·업종·커스텀 필드)을 반환합니다. 기본은 활성만입니다.',
  inputSchema: { includeInactive: z.boolean().optional() },
  mode: 'read',
  scope: 'sc:read',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    const personas = await prisma.persona.findMany({
      where: { spaceId: ctx.spaceId, ...(!params.includeInactive && { isActive: true }) },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        jobTitle: true,
        industry: true,
        customFields: true,
        isActive: true,
      },
    })
    return { personas }
  },
}

const listChannels: ToolDefinition = {
  name: 'sc_list_channels',
  description:
    '발행 채널 목록(플랫폼·종류·이름·발행 방식·활성 여부·자격증명 연결 여부)을 반환합니다. 자격증명 값과 채널 설정은 포함하지 않습니다.',
  inputSchema: {},
  mode: 'read',
  scope: 'sc:read',
  async execute(ctx) {
    await requireDeck(ctx.spaceId, DECK)
    const channels = await prisma.salesContentChannel.findMany({
      where: { spaceId: ctx.spaceId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        platform: true,
        kind: true,
        name: true,
        publisherMode: true,
        isActive: true,
        _count: { select: { credentials: true } },
      },
    })
    return {
      channels: channels.map(({ _count, ...c }) => ({
        ...c,
        hasCredential: _count.credentials > 0,
      })),
    }
  },
}

const contentStatus = z.enum([
  'TODO',
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
  'ANALYZED',
])

const listContents: ToolDefinition = {
  name: 'sc_list_contents',
  description:
    '콘텐츠 목록을 최신순으로 반환합니다(제목·상태·채널·예약/발행 시각, 본문은 앞 300자). status 로 좁힐 수 있습니다. 전체 본문·배포·성과는 sc_get_content 로 보세요.',
  inputSchema: {
    status: contentStatus.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  mode: 'read',
  scope: 'sc:read',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    const contents = await prisma.content.findMany({
      where: {
        spaceId: ctx.spaceId,
        ...(params.status ? { status: params.status as z.infer<typeof contentStatus> } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: (params.limit as number | undefined) ?? 20,
      select: {
        id: true,
        title: true,
        status: true,
        body: true,
        targetKeyword: true,
        scheduledAt: true,
        publishedAt: true,
        createdAt: true,
        channel: { select: channelSelect },
      },
    })
    return {
      contents: contents.map(({ body, channel, ...c }) => ({
        ...c,
        channel: own(ctx.spaceId, channel),
        bodyPreview: body ? body.slice(0, BODY_PREVIEW) : null,
      })),
    }
  },
}

const getContent: ToolDefinition = {
  name: 'sc_get_content',
  description:
    '콘텐츠 1건의 전체 본문과 배포 기록(채널·상태·게시 URL)·배포별 성과 합계(조회·좋아요·댓글·공유·외부 클릭)를 반환합니다.',
  inputSchema: { contentId: z.string().min(1) },
  mode: 'read',
  scope: 'sc:read',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    const content = await prisma.content.findFirst({
      where: { id: params.contentId as string, spaceId: ctx.spaceId },
      select: {
        id: true,
        title: true,
        status: true,
        body: true,
        targetKeyword: true,
        relatedKeywords: true,
        scheduledAt: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        channel: { select: channelSelect },
        deployments: {
          where: { spaceId: ctx.spaceId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            platformUrl: true,
            scheduledAt: true,
            publishedAt: true,
            errorMessage: true,
            channel: { select: channelSelect },
          },
        },
      },
    })
    if (!content) throw new ToolUserError('콘텐츠를 찾을 수 없습니다')

    // 같은 날짜에 MANUAL·BROWSER·API 행이 함께 있으면 화면과 같은 우선순위로 하나만 채택한 뒤 합산한다.
    const rows = content.deployments.length
      ? await prisma.deploymentMetric.findMany({
          where: {
            spaceId: ctx.spaceId,
            deploymentId: { in: content.deployments.map((d) => d.id) },
          },
          select: {
            deploymentId: true,
            date: true,
            source: true,
            impressions: true,
            views: true,
            likes: true,
            comments: true,
            shares: true,
            externalClicks: true,
          },
        })
      : []
    const metricKeys = ['views', 'likes', 'comments', 'shares', 'externalClicks'] as const
    const metricsFor = (deploymentId: string) => {
      const picked = pickDailyMetrics(rows.filter((r) => r.deploymentId === deploymentId))
      if (picked.length === 0) return null
      return Object.fromEntries(
        metricKeys.map((k) => [k, picked.reduce((sum, r) => sum + (r[k] ?? 0), 0)])
      )
    }
    const { channel, deployments, ...rest } = content
    return {
      ...rest,
      channel: own(ctx.spaceId, channel),
      deployments: deployments.map((d) => ({
        ...d,
        channel: own(ctx.spaceId, d.channel),
        // worker 원본 오류에 토큰·세션 값이 섞일 수 있다(알림 경로와 같은 마스킹).
        errorMessage: d.errorMessage ? redactErrorMessage(d.errorMessage) : null,
        metrics: metricsFor(d.id),
      })),
    }
  },
}

const proposePost: ToolDefinition = {
  name: 'sc_propose_post',
  description:
    '게시물 1건의 발행을 제안합니다(제목·본문·채널·연결 URL·예약 시각). 즉시 발행되지 않고 승인 대기 큐에 등록되며, 관리자(ADMIN)가 한 번 승인하면 콘텐츠가 만들어지고 해당 채널로 발행이 예약됩니다. 블로그·SNS 게시물을 요청받았을 때 결과물을 내는 경로가 이 도구입니다 — 대화에 본문을 붙이는 대신 여기로 올리고, 대화에는 제목과 승인 대기 등록 사실만 알리세요. 본문은 일반 텍스트로 쓰고 `# `·`## `·`### ` 로 시작하는 줄만 소제목이 됩니다(50자 이상). `*굵게*`·`_기울임_`·`**` 같은 마크다운·슬랙 서식은 변환되지 않고 기호가 그대로 게시되니 쓰지 마세요. 상품 사실(구성·대상·효능)은 sc_list_products 결과에 있는 것만 쓰고 지어내지 마세요. 활성 채널이 없으면 제안이 거부되니, 그때는 사용자에게 세일즈 콘텐츠 채널 등록이 필요하다고 알리세요. targetUrl 은 글에서 연결할 상품·랜딩 페이지이고, 클릭 추적용 짧은 링크로 바뀝니다. scheduledAt(ISO 8601)을 비우거나 승인 시점이 이미 지났으면 승인 즉시 발행합니다. 쓰기 전에 sc_list_brands 로 브랜드 톤을, sc_list_channels 로 채널 id 를 확인하세요.',
  inputSchema: postPublishParams.shape,
  mode: 'write',
  scope: 'sc:write',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    const parsed = postPublishParams.safeParse(params)
    if (!parsed.success) {
      throw new ToolUserError(
        `입력값 오류: ${parsed.error.issues.map((i) => i.message).join(', ')}`
      )
    }
    const p = parsed.data
    // 승인자가 채널을 id 가 아니라 이름으로 보게 요약에 싣는다(없으면 validateCreate 가 거부).
    const channel = await prisma.salesContentChannel.findFirst({
      where: { id: p.channelId, spaceId: ctx.spaceId },
      select: { name: true },
    })
    return createPendingAction({
      spaceId: ctx.spaceId,
      actionType: 'sales-content.post.publish',
      params: p,
      summary: `[${channel?.name ?? '채널'}] 게시물 발행 예약: ${p.title}${p.scheduledAt ? ` (${p.scheduledAt})` : ''}`,
      source: 'MCP',
      actor: ctx.actor,
      requesterUserId: ctx.requesterUserId,
      requesterSlackUserId: ctx.requesterSlackUserId,
      workId: ctx.workId,
      // 같은 제안 재시도가 승인 건을 중복으로 만들지 않게.
      idempotencyKey: idempotencyKeyFor('sales-content.post.publish', ctx.spaceId, p),
    })
  },
}

// 도구 입력은 brandId 대신 이름도 받는 brand — 액션 params 로 넘기기 전에 id 로 바꾼다.
const setupInput = setupApplyFields.omit({ brandId: true }).extend({
  brand: z.string().min(1).describe('브랜드 이름 또는 id(sc_list_brands 결과)'),
})

const proposeSetup: ToolDefinition = {
  name: 'sc_propose_setup',
  description:
    '브랜드 1개의 세일즈 콘텐츠 기초 데이터(발행 채널·브랜드 프로필·상품)를 한 번에 등록하도록 제안합니다. 즉시 반영되지 않고 승인 대기 큐에 올라가며, 관리자(ADMIN)가 한 번 승인하면 등록됩니다. sc_list_channels·sc_list_brands·sc_list_products 가 비어 있어 게시물을 만들 수 없을 때 쓰세요. channel 은 수동 발행 채널로 만들어집니다(예: 네이버 블로그 = platform BLOG_NAVER, kind BLOG, platformSlug naver-blog). 같은 platformSlug 채널이 이미 있으면 그대로 두고, 같은 브랜드에 같은 이름 상품이 있으면 건너뜁니다. profile 은 해당 브랜드 프로필에서 넘긴 필드만 덮어씁니다(companyName 필수, toneOfVoice 최대 10개, customFields 는 {key,value} 목록). 상품 이름·구성·특징은 seller-hub 상품 정보(sellerhub_get_product_options 등)나 브랜드 공식 사이트처럼 확인한 자료에서만 가져오고 지어내지 마세요. 확인하지 못한 항목은 비워 두세요. 대화에는 무엇을 승인 대기에 올렸는지만 짧게 알리세요.',
  inputSchema: setupInput.shape,
  mode: 'write',
  scope: 'sc:write',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    const input = setupInput.safeParse(params)
    if (!input.success) {
      throw new ToolUserError(`입력값 오류: ${input.error.issues.map((i) => i.message).join(', ')}`)
    }
    const { brand, ...rest } = input.data
    const brandId = (await resolveBrandId(ctx.spaceId, brand))!
    const parsed = setupApplyParams.safeParse({ ...rest, brandId })
    if (!parsed.success) {
      throw new ToolUserError(
        `입력값 오류: ${parsed.error.issues.map((i) => i.message).join(', ')}`
      )
    }
    const p = parsed.data
    const brandName = (
      await prisma.brand.findFirst({ where: { id: brandId }, select: { name: true } })
    )?.name
    const parts = [
      p.channel && `채널 「${p.channel.name}」`,
      p.profile && '브랜드 프로필',
      p.products?.length && `상품 ${p.products.length}개`,
    ].filter(Boolean)
    return createPendingAction({
      spaceId: ctx.spaceId,
      actionType: 'sales-content.setup.apply',
      params: p,
      summary: `[${brandName ?? brand}] 세일즈 콘텐츠 등록: ${parts.join(', ')}`,
      source: 'MCP',
      actor: ctx.actor,
      requesterUserId: ctx.requesterUserId,
      requesterSlackUserId: ctx.requesterSlackUserId,
      workId: ctx.workId,
      idempotencyKey: idempotencyKeyFor('sales-content.setup.apply', ctx.spaceId, p),
    })
  },
}

export const salesContentTools: ToolDefinition[] = [
  listBrands,
  listProducts,
  listPersonas,
  listChannels,
  listContents,
  getContent,
  proposePost,
  proposeSetup,
]
