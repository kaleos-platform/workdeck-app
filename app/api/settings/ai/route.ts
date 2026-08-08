/**
 * /api/settings/ai — 워크스페이스 전역 AI 공급자 설정.
 *   GET    — 모드·provider·모델·키 보유 여부·이번 달 텍스트 사용량
 *   PUT    — 모드 전환 및 BYOK 키 저장(암호화)
 *   DELETE — 키 삭제 후 워크덱 제공 모드로 복귀
 *
 * 키 원문·암호문·IV 는 어떤 응답에도 넣지 않는다 (ChannelCredential 라우트와 동일 원칙).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUser } from '@/hooks/use-user'
import { errorResponse, assertRole, resolveSpaceContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { encryptPii } from '@/lib/del/encryption'
import { getMonthUsage } from '@/lib/ai/credit'
import { workdeckProvider } from '@/lib/ai/resolve'

export const runtime = 'nodejs'

const putSchema = z
  .object({
    mode: z.enum(['WORKDECK', 'BYOK']),
    provider: z.enum(['OPENAI', 'ANTHROPIC', 'GEMINI']).optional(),
    model: z.string().trim().max(120).optional(),
    // 빈 문자열/미지정이면 기존 키 유지 (수정 시 키를 다시 입력하지 않아도 되게)
    apiKey: z.string().trim().min(8).max(400).optional(),
  })
  .refine((v) => v.mode !== 'BYOK' || Boolean(v.provider), {
    message: 'BYOK 모드에는 provider가 필요합니다',
  })

async function requireAdminSpace() {
  const user = await getUser()
  if (!user) return { error: errorResponse('인증이 필요합니다', 401) }
  const ctx = await resolveSpaceContext()
  if ('error' in ctx) return { error: ctx.error }
  const roleError = assertRole(ctx.role, 'ADMIN')
  if (roleError) return { error: roleError }
  return { spaceId: ctx.space.id }
}

export async function GET() {
  const ctx = await requireAdminSpace()
  if ('error' in ctx) return ctx.error

  const [setting, usage] = await Promise.all([
    prisma.spaceAiSetting.findUnique({
      where: { spaceId: ctx.spaceId },
      // encryptedApiKey 는 hasKey(boolean) 계산에만 쓰고 응답 본문에는 넣지 않는다.
      // apiKeyIv 는 아예 select 하지 않는다. 아래 return 문이 필드를 하나씩 나열하는 이유 —
      // setting 을 spread 하면 암호문이 그대로 새어나간다.
      select: {
        mode: true,
        provider: true,
        model: true,
        lastVerifiedAt: true,
        lastError: true,
        encryptedApiKey: true,
      },
    }),
    getMonthUsage(ctx.spaceId),
  ])

  return NextResponse.json({
    // 레코드가 없으면 워크덱 제공 모드
    mode: setting?.mode ?? 'WORKDECK',
    provider: setting?.provider ?? null,
    model: setting?.model ?? null,
    hasKey: Boolean(setting?.encryptedApiKey),
    lastVerifiedAt: setting?.lastVerifiedAt ?? null,
    lastError: setting?.lastError ?? null,
    workdeckAvailable: workdeckProvider() != null,
    usage: {
      yearMonth: usage.yearMonth,
      textTokensUsed: usage.textTokensUsed,
      textTokenQuota: usage.textTokenQuota,
    },
  })
}

export async function PUT(req: NextRequest) {
  const ctx = await requireAdminSpace()
  if ('error' in ctx) return ctx.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('요청 본문이 올바르지 않습니다', 400, { issues: parsed.error.flatten() })
  }
  const { mode, provider, model, apiKey } = parsed.data

  const existing = await prisma.spaceAiSetting.findUnique({
    where: { spaceId: ctx.spaceId },
    select: { encryptedApiKey: true },
  })

  if (mode === 'BYOK' && !apiKey && !existing?.encryptedApiKey) {
    return errorResponse('BYOK 모드로 전환하려면 API 키가 필요합니다', 400)
  }

  const keyFields = apiKey
    ? (() => {
        const { encrypted, iv } = encryptPii(apiKey)
        return { encryptedApiKey: encrypted, apiKeyIv: iv }
      })()
    : {}

  const data = {
    mode,
    provider: mode === 'BYOK' ? (provider ?? null) : null,
    model: mode === 'BYOK' ? (model || null) : null,
    ...keyFields,
    // 키나 provider 가 바뀌면 이전 검증 결과는 무의미
    ...(apiKey || provider ? { lastVerifiedAt: null, lastError: null } : {}),
  }

  const setting = await prisma.spaceAiSetting.upsert({
    where: { spaceId: ctx.spaceId },
    create: { spaceId: ctx.spaceId, ...data },
    update: data,
    select: { mode: true, provider: true, model: true, encryptedApiKey: true },
  })

  return NextResponse.json({
    mode: setting.mode,
    provider: setting.provider,
    model: setting.model,
    hasKey: Boolean(setting.encryptedApiKey),
  })
}

export async function DELETE() {
  const ctx = await requireAdminSpace()
  if ('error' in ctx) return ctx.error

  const existing = await prisma.spaceAiSetting.findUnique({
    where: { spaceId: ctx.spaceId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ mode: 'WORKDECK', hasKey: false })

  await prisma.spaceAiSetting.update({
    where: { spaceId: ctx.spaceId },
    data: {
      mode: 'WORKDECK',
      provider: null,
      model: null,
      encryptedApiKey: null,
      apiKeyIv: null,
      lastVerifiedAt: null,
      lastError: null,
    },
  })

  return NextResponse.json({ mode: 'WORKDECK', hasKey: false })
}
