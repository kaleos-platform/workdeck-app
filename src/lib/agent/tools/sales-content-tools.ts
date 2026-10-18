import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireDeck } from '@/lib/mcp/context'
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
    '브랜드 목록과 브랜드별 콘텐츠 프로필(회사명·한 줄 소개·톤·커스텀 필드)을 반환합니다. profile 이 null 인 브랜드는 공통 프로필(commonProfile)을 씁니다. 콘텐츠를 쓰기 전에 톤과 금칙어를 여기서 확인하세요.',
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

export const salesContentTools: ToolDefinition[] = [
  listBrands,
  listProducts,
  listPersonas,
  listChannels,
  listContents,
  getContent,
]
