import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { despaceKeyword } from '@/lib/sh/keyword-normalize'
import { atomicWordSchema } from '@/lib/sh/schemas'

/** 현재 Space 의 예외 단어(분해 금지 단어) 목록. */
export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const words = await prisma.spaceAtomicWord.findMany({
    where: { spaceId: resolved.space.id },
    select: { id: true, word: true },
    orderBy: { word: 'asc' },
  })

  return NextResponse.json({ words })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = atomicWordSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // 비교 키는 검증기와 같은 정규화를 쓴다 — 여기서 갈리면 등록해도 오탐이 안 사라진다.
  const normalized = despaceKeyword(parsed.data.word)
  if (normalized.length < 2) {
    return errorResponse('두 글자 이상이어야 합니다', 400)
  }

  // 같은 경고를 두 번 눌러 등록하는 일이 흔하다 — 409 대신 멱등 성공으로 둔다.
  const word = await prisma.spaceAtomicWord.upsert({
    where: { spaceId_normalized: { spaceId: resolved.space.id, normalized } },
    create: { spaceId: resolved.space.id, word: parsed.data.word, normalized },
    update: { word: parsed.data.word },
    select: { id: true, word: true },
  })

  return NextResponse.json({ word }, { status: 201 })
}
