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

const VALUE_RULE = '값은 공백 없는 영문·숫자·기호(ASCII) 8~4096자여야 합니다'

const bodySchema = z.object({
  // 헤더·query에 그대로 실리므로 출력 가능한 ASCII만(공백·제어문자·비ASCII 거부). 메시지에 값을 싣지 않는다.
  value: z
    .string()
    .min(8, VALUE_RULE)
    .max(4096, VALUE_RULE)
    .regex(/^[\x21-\x7e]+$/, VALUE_RULE),
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
  const raw = await req.json().catch(() => null)
  // kind를 먼저 본다 — LOGIN·ENV는 config 모양이 달라 스키마 오류가 아니라 이 안내를 받아야 한다.
  if ((raw as { kind?: unknown } | null)?.kind !== 'API_KEY') {
    return errorResponse('이 단계에서는 API_KEY만 등록할 수 있습니다', 400)
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  const { value, config } = parsed.data

  const existing = await findSecretKind(spaceId, name)
  if (existing && existing !== 'API_KEY') {
    return errorResponse('종류는 바꿀 수 없습니다. 삭제 후 다시 등록하세요', 409)
  }

  const allowedAgentIds = [...new Set(parsed.data.allowedAgentIds)]
  if (allowedAgentIds.length > 0) {
    const found = await prisma.spaceAgent.count({
      where: { spaceId, status: 'ACTIVE', id: { in: allowedAgentIds } },
    })
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
