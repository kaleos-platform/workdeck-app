import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { loadAdTermsForProduct } from '@/lib/sh/ad-terms-query'
import {
  draftProductNames,
  KEYWORD_OVERGENERATE,
  KEYWORD_TARGET,
  REVIEW_LIMIT,
  type NameDraftInput,
} from '@/lib/sh/keyword-ai-draft'
import { filterDraftKeywords } from '@/lib/sh/keyword-draft-filter'
import { loadKeywordRules } from '@/lib/sh/keyword-rules-query'
import { validateProductName, type Violation } from '@/lib/sh/keyword-validate'
import { productDisplayName } from '@/lib/sh/product-display'

/** 광고 근거로 프롬프트에 넣을 실검색어 수. 너무 많이 넣으면 입력 토큰만 커진다. */
const AD_TERM_HINTS = 15
/** 참고용으로 넣을 KeywordMaster 풀 크기. */
const KEYWORD_POOL_HINTS = 40

type Params = { params: Promise<{ productId: string }> }

type OptionAttribute = { name?: unknown; values?: unknown }

/** Prisma Json? 필드를 방어적으로 string[] 로 좁힌다 — 타입 캐스팅으로 신뢰하지 않는다. */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** InvProduct.optionAttributes([{name, values}]) → '색상: 블랙/화이트' 형태 요약. */
function summarizeOptionAttributes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw as OptionAttribute[]) {
    if (!entry || typeof entry !== 'object') continue
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const values = toStringArray(entry.values)
    if (!name || values.length === 0) continue
    out.push(`${name}: ${values.join('/')}`)
  }
  return out
}

/** AI 후보 문자열에 검증 결과(violations)를 붙인다. */
type ScoredCandidate = { value: string; violations: Violation[] }

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const channelId = (body as { channelId?: unknown } | null)?.channelId
  if (typeof channelId !== 'string' || !channelId.trim()) {
    return errorResponse('channelId 가 필요합니다', 400)
  }

  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: {
      id: true,
      name: true,
      internalName: true,
      description: true,
      features: true,
      certifications: true,
      optionAttributes: true,
      brand: { select: { name: true } },
      group: { select: { name: true } },
    },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true, name: true },
  })
  if (!channel) return errorResponse('판매채널을 찾을 수 없습니다', 404)

  const rules = await loadKeywordRules(resolved.space.id, channelId)

  // 이미 등록된 검색어 — 화면에서 편집되는 Json 배열(ChannelProduct/ProductListing)과
  // 상품 단위 귀속(KeywordMasterLink)을 합친다.
  //
  // ⚠️ ChannelProduct.keywords 를 빼면 안 된다. 채널상품 카드가 편집·표시하는 값이 바로 이것이고,
  // KeywordMaster 와는 **동기화되지 않는다**(schema.prisma 의 KeywordMaster 상단 주석). 이게
  // 빠지면 화면에 이미 있는 검색어를 AI 가 다시 추천하고(중복 필터가 새고), 진단 대상도 화면과
  // 어긋난다.
  const [links, listings, channelProducts, pool, adTerms] = await Promise.all([
    prisma.keywordMasterLink.findMany({
      where: { productId, keyword: { spaceId: resolved.space.id } },
      select: { keyword: { select: { keyword: true } } },
    }),
    prisma.productListing.findMany({
      where: { spaceId: resolved.space.id, items: { some: { option: { productId } } } },
      select: { keywords: true },
    }),
    prisma.channelProduct.findMany({
      where: {
        spaceId: resolved.space.id,
        channelId,
        listings: { some: { items: { some: { option: { productId } } } } },
      },
      select: { keywords: true },
    }),
    prisma.keywordMaster.findMany({
      where: { spaceId: resolved.space.id, status: { in: ['SEARCH_TERM', 'CANDIDATE'] } },
      select: { keyword: true },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      take: KEYWORD_POOL_HINTS,
    }),
    loadAdTermsForProduct(resolved.space.id, productId, AD_TERM_HINTS),
  ])
  // 카드 자신의 값(Json 배열)을 앞에 둔다 — REVIEW_LIMIT 로 자를 때 화면에 보이는 것부터 남는다.
  const existingKeywords = [
    ...new Set([
      ...channelProducts.flatMap((c) => toStringArray(c.keywords)),
      ...listings.flatMap((l) => toStringArray(l.keywords)),
      ...links.map((l) => l.keyword.keyword),
    ]),
  ].slice(0, REVIEW_LIMIT)

  const productName = product.name || productDisplayName(product)
  const draftInput: NameDraftInput = {
    brandName: product.brand?.name ?? null,
    productName,
    categoryName: product.group?.name ?? null,
    description: product.description,
    features: toStringArray(product.features),
    certifications: toStringArray(product.certifications),
    optionSummary: summarizeOptionAttributes(product.optionAttributes),
    existingKeywords,
    adTerms: adTerms.data.map((t) => ({
      keyword: t.keyword,
      clicks: t.clicks,
      orders: t.orders,
    })),
    keywordPool: pool.map((k) => k.keyword),
    channelName: channel.name,
    nameTargetMin: rules.nameTargetMin,
    nameTargetMax: rules.nameTargetMax,
  }

  const startedAt = Date.now()
  const draft = await draftProductNames(draftInput)
  const latencyMs = Date.now() - startedAt

  if (!draft) {
    await logDraftUsage({
      spaceId: resolved.space.id,
      userId: resolved.user.id,
      status: 'FAILED',
      contentPreview: null,
      latencyMs,
    })
    return NextResponse.json({ names: [], keywords: [], reviews: [], unavailable: true })
  }

  const names: ScoredCandidate[] = draft.names.map((value) => ({
    value,
    violations: validateProductName(value, rules).violations,
  }))

  // 검색어는 등록분과 병합해 한 번에 검증한다 — 후보↔등록분 중복, 후보끼리 중복, 등록분 진단이
  // 한 패스에서 나온다. 결정적 규칙에 걸린 후보는 여기서 버려지고(AI 판정은 버리지 않는다),
  // 판정 기준 상품명은 AI 후보가 아니라 현재 등록된 상품명이다(호출 시점 문맥과 동일).
  const { keywords, reviews } = filterDraftKeywords({
    existingKeywords,
    candidates: draft.keywords,
    reviews: draft.reviews,
    productName,
    categoryNames: draftInput.categoryName ? [draftInput.categoryName] : [],
    optionNames: draftInput.optionSummary,
    rules,
    target: KEYWORD_TARGET,
  })

  await logDraftUsage({
    spaceId: resolved.space.id,
    userId: resolved.user.id,
    status: 'SUCCEEDED',
    // 원문을 500자로 자르면 names 만 담고 끝난다(응답이 커졌다) — 요약을 남긴다.
    contentPreview: JSON.stringify({
      names: draft.names,
      generated: draft.keywords.length,
      kept: keywords.length,
      reviews: reviews.length,
      overgenerate: KEYWORD_OVERGENERATE,
    }).slice(0, 500),
    latencyMs,
  })

  return NextResponse.json({ names, keywords, reviews })
}

/** TextGenerationLog 감사 기록. 실패해도 응답을 막지 않는다 — try/catch 로 흡수. */
function logDraftUsage(input: {
  spaceId: string
  userId: string
  status: 'SUCCEEDED' | 'FAILED'
  contentPreview: string | null
  latencyMs: number
}) {
  // 프라미스를 반환한다 — 호출부가 await 해도 이걸 안 돌려주면 undefined 를 기다리게 되고,
  // Vercel 서버리스는 응답 직후 인스턴스를 얼려서 기록이 유실된다(하필 FAILED 경로가 제일 중요).
  return prisma.textGenerationLog
    .create({
      data: {
        spaceId: input.spaceId,
        userId: input.userId,
        provider: 'gemini-api',
        model: process.env.AI_PRIMARY_MODEL ?? 'gemini-2.5-flash',
        responseFormat: 'json',
        status: input.status,
        contentPreview: input.contentPreview,
        latencyMs: input.latencyMs,
      },
    })
    .catch(() => {})
}
