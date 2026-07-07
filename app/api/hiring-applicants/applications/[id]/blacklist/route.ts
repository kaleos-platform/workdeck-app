// 지원서 → 블랙리스트 등록 — 쓰기 권한 + spaceId 스코프.
// 전화번호는 서버에서만 복호화해 buildBlacklistPhone 으로 enc/hash 생성(평문 미노출).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, errorResponse, assertRole } from '@/lib/api-helpers'
import { decryptApplicationPii, buildBlacklistPhone } from '@/lib/hiring/pii'
import { z } from 'zod'

type Params = { params: Promise<{ id: string }> }

const schema = z.object({ reason: z.string().max(500).optional() })

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error

  const roleError = assertRole(resolved.role, 'ADMIN')
  if (roleError) return roleError
  const { id } = await params

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body ?? {})
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)

  const app = await prisma.hiringApplication.findFirst({
    where: { id, spaceId: resolved.space.id, deletedAt: null },
    select: {
      nameEnc: true,
      nameIv: true,
      phoneEnc: true,
      phoneIv: true,
      emailEnc: true,
      emailIv: true,
      addressEnc: true,
      addressIv: true,
    },
  })
  if (!app) return errorResponse('지원서를 찾을 수 없습니다', 404)

  const { phone } = decryptApplicationPii(app)
  if (!phone) return errorResponse('연락처가 없어 블랙리스트에 등록할 수 없습니다', 400)

  const { phoneEnc, phoneIv, phoneHash } = buildBlacklistPhone(phone)

  // 이미 등록된 번호면 재활성화 + 사유 갱신
  const existing = await prisma.hiringBlacklist.findFirst({
    where: { spaceId: resolved.space.id, phoneHash },
    select: { id: true },
  })
  if (existing) {
    await prisma.hiringBlacklist.update({
      where: { id: existing.id },
      data: { isActive: true, reason: parsed.data.reason ?? null },
    })
    return NextResponse.json({ ok: true, id: existing.id })
  }

  const created = await prisma.hiringBlacklist.create({
    data: {
      spaceId: resolved.space.id,
      phoneEnc,
      phoneIv,
      phoneHash,
      reason: parsed.data.reason ?? null,
    },
    select: { id: true },
  })
  return NextResponse.json({ ok: true, id: created.id }, { status: 201 })
}
