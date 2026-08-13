import { NextRequest, NextResponse } from 'next/server'

import { resolveAnyDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { channelKeywordRuleSchema } from '@/lib/sh/schemas'
import { resolveKeywordRules } from '@/lib/sh/keyword-rules'
import {
  ruleRowToOverride,
  serializeKeywordRules,
  parseBannedTerms,
} from '@/lib/sh/keyword-rules-query'

/**
 * 채널별 키워드/상품명 규칙 오버라이드.
 *
 * 행이 없는 것이 정상 상태(= 기본값 사용)이므로 GET 은 404 가 아니라 기본값을 돌려준다.
 * 응답의 `rules` 는 기본값과 병합된 최종 규칙, `override` 는 저장된 원본(없으면 null).
 */

type Params = { params: Promise<{ channelId: string }> }
const DECKS = ['seller-hub', 'coupang-ads']

const ruleSelect = {
  id: true,
  channelId: true,
  maxKeywords: true,
  nameTargetMin: true,
  nameTargetMax: true,
  nameSoftMax: true,
  nameHardMax: true,
  bannedTerms: true,
  replaceDefaultTerms: true,
  updatedAt: true,
} as const

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveAnyDeckContext(DECKS)
  if ('error' in resolved) return resolved.error

  const { channelId } = await params

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  const row = await prisma.channelKeywordRule.findFirst({
    where: { channelId, spaceId: resolved.space.id },
    select: ruleSelect,
  })

  return NextResponse.json({
    rules: serializeKeywordRules(resolveKeywordRules(ruleRowToOverride(row))),
    override: row ? { ...row, bannedTerms: parseBannedTerms(row.bannedTerms) ?? {} } : null,
  })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const resolved = await resolveAnyDeckContext(DECKS)
  if ('error' in resolved) return resolved.error

  const { channelId } = await params

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))
  const parsed = channelKeywordRuleSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  // 길이 구간이 뒤집히면 검증 결과가 무의미해진다.
  if (
    input.nameTargetMin != null &&
    input.nameTargetMax != null &&
    input.nameTargetMin > input.nameTargetMax
  ) {
    return errorResponse('상품명 목표 길이 하한이 상한보다 큽니다', 400)
  }

  const data = {
    maxKeywords: input.maxKeywords ?? null,
    nameTargetMin: input.nameTargetMin ?? null,
    nameTargetMax: input.nameTargetMax ?? null,
    nameSoftMax: input.nameSoftMax ?? null,
    nameHardMax: input.nameHardMax ?? null,
    bannedTerms: input.bannedTerms ?? {},
    replaceDefaultTerms: input.replaceDefaultTerms ?? false,
  }

  // channelId 가 @unique 라 upsert 가 안전하다(널 조합 문제가 없다).
  const row = await prisma.channelKeywordRule.upsert({
    where: { channelId },
    create: { spaceId: resolved.space.id, channelId, ...data },
    update: data,
    select: ruleSelect,
  })

  return NextResponse.json({
    rules: serializeKeywordRules(resolveKeywordRules(ruleRowToOverride(row))),
    override: { ...row, bannedTerms: parseBannedTerms(row.bannedTerms) ?? {} },
  })
}
