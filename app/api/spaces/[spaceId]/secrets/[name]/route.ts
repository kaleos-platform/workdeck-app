/**
 * PUT — 비밀값 등록·교체, DELETE — 삭제(ADMIN 이상 + MFA aal2). 본문은 권한·MFA 검사 뒤에 읽는다.
 * 평문은 요청 본문으로만 받고 응답에 돌려주지 않는다. 이 단계에서는 API_KEY만 받는다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api-helpers'
import { requireAal2 } from '@/lib/auth/mfa'
import { prisma } from '@/lib/prisma'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { apiKeyConfigSchema } from '@/lib/agent/secrets/config'
import {
  SECRET_NAME_RE,
  deleteSecret,
  findSecretKind,
  saveApiKeySecret,
} from '@/lib/agent/secrets/store'

type Ctx = { params: Promise<{ spaceId: string; name: string }> }

const bodySchema = z.object({
  kind: z.string(),
  value: z.string().min(8).max(4096),
  config: apiKeyConfigSchema,
  allowedAgentIds: z.array(z.string()).max(100),
})

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { spaceId, name } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  const mfaError = await requireAal2()
  if (mfaError) return mfaError

  if (!SECRET_NAME_RE.test(name)) return errorResponse('이름이 올바르지 않습니다', 400)
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  const { kind, value, config } = parsed.data
  if (kind !== 'API_KEY') return errorResponse('이 단계에서는 API_KEY만 등록할 수 있습니다', 400)

  const existing = await findSecretKind(spaceId, name)
  if (existing && existing !== 'API_KEY') {
    return errorResponse('종류는 바꿀 수 없습니다. 삭제 후 다시 등록하세요', 409)
  }

  const allowedAgentIds = [...new Set(parsed.data.allowedAgentIds)]
  if (allowedAgentIds.length > 0) {
    const found = await prisma.spaceAgent.count({ where: { spaceId, id: { in: allowedAgentIds } } })
    if (found !== allowedAgentIds.length) {
      return errorResponse('이 Space의 에이전트만 허용할 수 있습니다', 400)
    }
  }

  const saved = await saveApiKeySecret(spaceId, name, value, config, allowedAgentIds, auth.userId)
  return NextResponse.json(
    { name, revision: saved.revision },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { spaceId, name } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  const mfaError = await requireAal2()
  if (mfaError) return mfaError

  if (!(await deleteSecret(spaceId, name))) return errorResponse('비밀값을 찾을 수 없습니다', 404)
  return new NextResponse(null, { status: 204 })
}
