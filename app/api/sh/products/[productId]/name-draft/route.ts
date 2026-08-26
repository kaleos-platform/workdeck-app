import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { draftProductNames, type NameDraftInput } from '@/lib/sh/keyword-ai-draft'
import { loadKeywordRules } from '@/lib/sh/keyword-rules-query'
import { validateProductName, validateKeywords, type Violation } from '@/lib/sh/keyword-validate'
import { productDisplayName } from '@/lib/sh/product-display'

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

  // 이미 등록된 검색어 — 상품 단위 귀속(KeywordMasterLink) + 이 상품이 걸린 리스팅들의 키워드.
  const [links, listings] = await Promise.all([
    prisma.keywordMasterLink.findMany({
      where: { productId, keyword: { spaceId: resolved.space.id } },
      select: { keyword: { select: { keyword: true } } },
    }),
    prisma.productListing.findMany({
      where: { spaceId: resolved.space.id, items: { some: { option: { productId } } } },
      select: { keywords: true },
    }),
  ])
  const existingKeywords = [
    ...new Set([
      ...links.map((l) => l.keyword.keyword),
      ...listings.flatMap((l) => toStringArray(l.keywords)),
    ]),
  ]

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
    return NextResponse.json({ names: [], keywords: [], unavailable: true })
  }

  const names: ScoredCandidate[] = draft.names.map((value) => ({
    value,
    violations: validateProductName(value, rules).violations,
  }))

  // 검색어 후보는 서로 간의 중복(§11/§12)·상품명 중복(§10)까지 한 번에 검증한다.
  // 판정 기준 상품명은 AI 후보가 아니라 현재 등록된 상품명(호출 시점 문맥과 동일).
  const kwValidation =
    draft.keywords.length > 0
      ? validateKeywords({
          keywords: draft.keywords,
          productName,
          categoryNames: draftInput.categoryName ? [draftInput.categoryName] : [],
          optionNames: draftInput.optionSummary,
          rules,
        })
      : null
  const violationsByIndex = new Map<number, Violation[]>()
  for (const v of kwValidation?.violations ?? []) {
    if (v.keywordIndex === null) continue
    const list = violationsByIndex.get(v.keywordIndex)
    if (list) list.push(v)
    else violationsByIndex.set(v.keywordIndex, [v])
  }
  const keywords: ScoredCandidate[] = draft.keywords.map((value, index) => ({
    value,
    violations: violationsByIndex.get(index) ?? [],
  }))

  await logDraftUsage({
    spaceId: resolved.space.id,
    userId: resolved.user.id,
    status: 'SUCCEEDED',
    contentPreview: JSON.stringify(draft).slice(0, 500),
    latencyMs,
  })

  return NextResponse.json({ names, keywords })
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
