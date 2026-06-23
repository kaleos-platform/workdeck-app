import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { toNumOrNull } from '@/lib/finance/serialize'

const VALID_KINDS = ['BANK', 'CARD'] as const
type AccountKind = (typeof VALID_KINDS)[number]

// 조회: spaceId 기준 계좌 전체 (createdAt asc)
export async function GET() {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const accounts = await prisma.finAccount.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({
    accounts: accounts.map((a) => ({
      ...a,
      openingBalance: toNumOrNull(a.openingBalance),
    })),
  })
}

// 생성: 계좌 추가
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const body = await req.json().catch(() => ({}))
  const { name, kind, institution, accountNumber, accountType, openingBalance } = body as {
    name?: string
    kind?: string
    institution?: string
    accountNumber?: string
    accountType?: string
    openingBalance?: number
  }

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return errorResponse('계좌 이름이 필요합니다', 400)
  }
  if (!kind || !VALID_KINDS.includes(kind as AccountKind)) {
    return errorResponse('kind는 BANK 또는 CARD여야 합니다', 400)
  }
  if (!institution || typeof institution !== 'string' || institution.trim() === '') {
    return errorResponse('금융기관명이 필요합니다', 400)
  }

  // 계좌번호 중복 검증
  if (accountNumber && accountNumber.trim() !== '') {
    const duplicate = await prisma.finAccount.findFirst({
      where: { spaceId, accountNumber: accountNumber.trim() },
      select: { id: true },
    })
    if (duplicate) return errorResponse('이미 등록된 계좌입니다', 409)
  }

  try {
    const account = await prisma.finAccount.create({
      data: {
        spaceId,
        name: name.trim(),
        kind: kind as AccountKind,
        institution: institution.trim(),
        accountNumber: accountNumber?.trim() ?? null,
        accountType: accountType?.trim() ?? null,
        openingBalance: openingBalance ?? null,
      },
    })

    return NextResponse.json(
      { account: { ...account, openingBalance: toNumOrNull(account.openingBalance) } },
      { status: 201 }
    )
  } catch (e: unknown) {
    const err = e as { code?: string }
    if (err?.code === 'P2002') {
      return errorResponse('이미 등록된 계좌입니다', 409)
    }
    throw e
  }
}
