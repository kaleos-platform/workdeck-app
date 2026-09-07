import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { loadAtomicWords } from '@/lib/sh/keyword-atomic-query'
import { validateListingNaming } from '@/lib/sh/keyword-validate'
import { keywordValidateSchema } from '@/lib/sh/schemas'
import { loadKeywordRules, serializeKeywordRules } from '@/lib/sh/keyword-rules-query'

/**
 * validateListingNaming 서버측 래퍼 — 저장 전 프리뷰용.
 * 클라이언트가 같은 순수 함수를 직접 호출해도 되지만, 채널 규칙 오버라이드를 적용한
 * "서버가 실제로 보는 결과"를 확인할 수 있어야 한다.
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = keywordValidateSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  const [rules, atomicWords, brands] = await Promise.all([
    loadKeywordRules(resolved.space.id, input.channelId),
    loadAtomicWords(resolved.space.id),
    prisma.brand.findMany({ where: { spaceId: resolved.space.id }, select: { name: true } }),
  ])

  const result = validateListingNaming({
    searchName: input.searchName,
    displayName: input.displayName,
    keywords: input.keywords,
    categoryNames: input.categoryNames,
    optionNames: input.optionNames,
    brandNames: brands.map((b) => b.name),
    atomicWords,
    rules,
  })

  return NextResponse.json({ ...result, rules: serializeKeywordRules(rules) })
}
