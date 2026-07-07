import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { regenerateBoPost, regenerateSection } from '@/lib/bo/draft-generator'
import { regenerateBoPostBodySchema } from '@/lib/bo/post-schemas'

// AI 재생성 최대 대기 시간 (Vercel Fluid 컴퓨트 기준)
export const maxDuration = 180

type Params = { params: Promise<{ id: string }> }

// POST /api/bo/posts/[id]/regenerate
// { scope: 'full' }                                  → 전체 재생성
// { scope: 'section', heading, instruction? }        → 섹션 단위 재생성
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = regenerateBoPostBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const data = parsed.data

  if (data.scope === 'full') {
    const result = await regenerateBoPost({
      postId: id,
      spaceId: resolved.space.id,
      userId: resolved.user.id,
    })

    if (!result.ok) {
      const status = result.code === 'POST_NOT_FOUND' ? 404 : 500
      return errorResponse(result.message, status, { code: result.code })
    }

    return NextResponse.json({ ok: true, providerName: result.providerName })
  }

  // scope === 'section'
  const result = await regenerateSection({
    postId: id,
    spaceId: resolved.space.id,
    userId: resolved.user.id,
    heading: data.heading,
    instruction: data.instruction ?? null,
  })

  if (!result.ok) {
    const status =
      result.code === 'POST_NOT_FOUND' || result.code === 'SECTION_NOT_FOUND' ? 404 : 500
    return errorResponse(result.message, status, { code: result.code })
  }

  return NextResponse.json({ ok: true, providerName: result.providerName })
}
