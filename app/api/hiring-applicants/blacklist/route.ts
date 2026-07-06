// 블랙리스트 목록/등록 — 목록은 읽기 권한, 등록은 쓰기 권한. spaceId 스코프.
// 전화번호는 서버 복호화 후 마스킹(010-****-1234)해서만 반환한다.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  resolveAnyDeckContext,
  resolveDeckContext,
  errorResponse,
  assertRole,
} from '@/lib/api-helpers'
import { buildBlacklistPhone } from '@/lib/hiring/pii'
import { decryptBlacklistPhoneMasked } from '@/lib/hiring/applications'
import { blacklistCreateSchema } from '@/lib/validations/hiring-applicants'

export async function GET() {
  const resolved = await resolveAnyDeckContext(['hiring-applicants', 'hiring-posts'])
  if ('error' in resolved) return resolved.error

  const rows = await prisma.hiringBlacklist.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      phoneEnc: true,
      phoneIv: true,
      reason: true,
      isActive: true,
      createdAt: true,
    },
  })

  const items = rows.map((r) => ({
    id: r.id,
    maskedPhone: decryptBlacklistPhoneMasked(r.phoneEnc, r.phoneIv),
    reason: r.reason,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  }))
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('hiring-applicants')
  if ('error' in resolved) return resolved.error

  const roleError = assertRole(resolved.role, 'ADMIN')
  if (roleError) return roleError

  const body = await req.json().catch(() => null)
  const parsed = blacklistCreateSchema.safeParse(body)
  if (!parsed.success) return errorResponse('전화번호를 입력하세요', 400)

  const { phoneEnc, phoneIv, phoneHash } = buildBlacklistPhone(parsed.data.phone)

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
