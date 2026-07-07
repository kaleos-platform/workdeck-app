import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { toNum, toNumOrNull } from '@/lib/finance/serialize'

// 수정: 부채 부분 업데이트
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const {
    name,
    lender,
    principal,
    balance,
    rate,
    dueDate,
    monthlyPayment,
    memo,
    accountId,
    balanceAsOf,
  } = body as {
    name?: string
    lender?: string
    principal?: number
    balance?: number
    rate?: string
    dueDate?: string
    monthlyPayment?: number | null
    memo?: string
    accountId?: string | null
    balanceAsOf?: string | null // ISO 문자열 — 상환 반영 시 워터마크 전진
  }

  // spaceId 소유 검증
  const existing = await prisma.finLiability.findFirst({
    where: { id, spaceId },
    select: { id: true },
  })
  if (!existing) return errorResponse('부채를 찾을 수 없습니다', 404)

  // 연결 계좌 검증 — accountId가 요청에 포함된 경우에만 처리(빈 값=연결 해제)
  let normalizedAccountId: string | null | undefined = undefined
  if (accountId !== undefined) {
    normalizedAccountId = accountId?.trim() ? accountId.trim() : null
    if (normalizedAccountId) {
      const account = await prisma.finAccount.findFirst({
        where: { id: normalizedAccountId, spaceId },
        select: { id: true },
      })
      if (!account) return errorResponse('연결할 계좌를 찾을 수 없습니다', 400)
    }
  }

  // 워터마크 — balanceAsOf가 요청에 포함된 경우에만 처리(ISO 문자열 또는 null)
  let normalizedBalanceAsOf: Date | null | undefined = undefined
  if (balanceAsOf !== undefined) {
    if (balanceAsOf === null) {
      normalizedBalanceAsOf = null
    } else {
      const parsed = new Date(balanceAsOf)
      if (Number.isNaN(parsed.getTime()))
        return errorResponse('balanceAsOf 형식이 올바르지 않습니다', 400)
      normalizedBalanceAsOf = parsed
    }
  }

  const liability = await prisma.finLiability.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(lender !== undefined && { lender: lender?.trim() ?? null }),
      ...(principal !== undefined && { principal }),
      ...(balance !== undefined && { balance }),
      ...(rate !== undefined && { rate }),
      ...(dueDate !== undefined && { dueDate }),
      ...(monthlyPayment !== undefined && { monthlyPayment }),
      ...(memo !== undefined && { memo: memo?.trim() ?? null }),
      ...(normalizedAccountId !== undefined && { accountId: normalizedAccountId }),
      ...(normalizedBalanceAsOf !== undefined && { balanceAsOf: normalizedBalanceAsOf }),
    },
  })

  return NextResponse.json({
    liability: {
      ...liability,
      principal: toNum(liability.principal),
      balance: toNum(liability.balance),
      monthlyPayment: toNumOrNull(liability.monthlyPayment),
    },
  })
}

// 삭제: 부채 제거
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const { id } = await params

  const existing = await prisma.finLiability.findFirst({
    where: { id, spaceId },
    select: { id: true },
  })
  if (!existing) return errorResponse('부채를 찾을 수 없습니다', 404)

  await prisma.finLiability.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
