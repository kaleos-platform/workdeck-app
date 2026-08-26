import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { keywordMasterPatchSchema } from '@/lib/sh/schemas'
import { keywordKeys } from '@/lib/sh/keyword-normalize'
import { scoreKeyword, type KeywordScoreInputs } from '@/lib/sh/keyword-score'
import { serializeKeyword, keywordSelect } from '@/lib/sh/keyword-serialize'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  // id 만으로 찾지 않는다 — 다른 space 의 키워드를 수정할 수 없어야 한다.
  const existing = await prisma.keywordMaster.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, keyword: true },
  })
  if (!existing) return errorResponse('키워드를 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))
  const parsed = keywordMasterPatchSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  // 원문이 바뀌면 3키를 반드시 재계산한다(파생값이므로 따로 두면 중복 탐지가 무너진다).
  const nextKeyword = input.keyword?.trim()
  const keys = nextKeyword && nextKeyword !== existing.keyword ? keywordKeys(nextKeyword) : null

  // scoreInputs 만 바뀌어도 점수를 다시 파생한다(§17 결과와 입력 스냅샷의 정합).
  const score =
    input.score ??
    (input.scoreInputs ? scoreKeyword(input.scoreInputs as KeywordScoreInputs).score : undefined)

  try {
    const updated = await prisma.keywordMaster.update({
      where: { id },
      data: {
        keyword: nextKeyword ?? undefined,
        normalized: keys?.normalized,
        despaced: keys?.despaced,
        sortedKey: keys?.sortedKey,
        category: input.category === undefined ? undefined : input.category,
        type: input.type ?? undefined,
        source: input.source ?? undefined,
        status: input.status ?? undefined,
        score,
        scoreInputs: input.scoreInputs ?? undefined,
        memo: input.memo === undefined ? undefined : input.memo,
        researchedAt: input.researchedAt === undefined ? undefined : input.researchedAt,
      },
      select: keywordSelect,
    })
    return NextResponse.json({ keyword: serializeKeyword(updated) })
  } catch (e) {
    // 원문 변경으로 @@unique([spaceId, normalized]) 충돌 — POST 와 같은 409 계약.
    if ((e as { code?: string }).code === 'P2002' && keys) {
      const conflict = await prisma.keywordMaster.findFirst({
        where: { spaceId: resolved.space.id, normalized: keys.normalized },
        select: keywordSelect,
      })
      return errorResponse('이미 등록된 키워드입니다', 409, {
        keyword: conflict ? serializeKeyword(conflict) : null,
      })
    }
    throw e
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  const existing = await prisma.keywordMaster.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('키워드를 찾을 수 없습니다', 404)

  // 연결(KeywordMasterLink)은 onDelete: Cascade 로 함께 정리된다.
  await prisma.keywordMaster.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
