import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { toNumOrNull } from '@/lib/finance/serialize'

// 수정: 계좌 부분 업데이트
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const {
    name,
    holder,
    institution,
    accountNumber,
    accountType,
    openingBalance,
    currentBalance,
    currentBalanceAsOf,
  } = body as {
    name?: string
    holder?: string | null
    institution?: string
    accountNumber?: string
    accountType?: string
    openingBalance?: number | null
    currentBalance?: number | null
    currentBalanceAsOf?: string | null
  }

  // spaceId 소유 검증
  const existing = await prisma.finAccount.findFirst({
    where: { id, spaceId },
    select: { id: true, accountNumber: true },
  })
  if (!existing) return errorResponse('계좌를 찾을 수 없습니다', 404)

  // 계좌번호 변경 시 중복 검증
  if (
    accountNumber !== undefined &&
    accountNumber !== null &&
    accountNumber.trim() !== '' &&
    accountNumber.trim() !== existing.accountNumber
  ) {
    const duplicate = await prisma.finAccount.findFirst({
      where: { spaceId, accountNumber: accountNumber.trim(), NOT: { id } },
      select: { id: true },
    })
    if (duplicate) return errorResponse('이미 등록된 계좌번호입니다', 409)
  }

  try {
    const account = await prisma.finAccount.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(holder !== undefined && { holder: holder?.trim() || null }),
        ...(institution !== undefined && { institution: institution.trim() }),
        ...(accountNumber !== undefined && { accountNumber: accountNumber?.trim() ?? null }),
        ...(accountType !== undefined && { accountType: accountType?.trim() ?? null }),
        ...(openingBalance !== undefined && { openingBalance }),
        ...(currentBalance !== undefined && { currentBalance }),
        ...(currentBalanceAsOf !== undefined && {
          currentBalanceAsOf: currentBalanceAsOf ? new Date(currentBalanceAsOf) : null,
        }),
      },
    })

    return NextResponse.json({
      account: {
        ...account,
        openingBalance: toNumOrNull(account.openingBalance),
        currentBalance: toNumOrNull(account.currentBalance),
      },
    })
  } catch (e: unknown) {
    const err = e as { code?: string }
    if (err?.code === 'P2002') {
      return errorResponse('이미 등록된 계좌번호입니다', 409)
    }
    throw e
  }
}

// 삭제: 연결된 FinTransaction 수 포함, 거래·임포트는 cascade
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const { id } = await params

  const existing = await prisma.finAccount.findFirst({
    where: { id, spaceId },
    select: { id: true },
  })
  if (!existing) return errorResponse('계좌를 찾을 수 없습니다', 404)

  // 삭제 전 연결된 거래·스테이징 수 집계 (cascade로 함께 삭제됨)
  const [txCount, stagedCount] = await Promise.all([
    prisma.finTransaction.count({ where: { accountId: id } }),
    prisma.finStagedRow.count({ where: { accountId: id } }),
  ])

  await prisma.finAccount.delete({ where: { id } })

  return NextResponse.json({ ok: true, deletedTransactions: txCount, stagedCount })
}
