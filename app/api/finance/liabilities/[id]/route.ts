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
  const { name, lender, principal, balance, rate, dueDate, monthlyPayment, memo } = body as {
    name?: string
    lender?: string
    principal?: number
    balance?: number
    rate?: string
    dueDate?: string
    monthlyPayment?: number | null
    memo?: string
  }

  // spaceId 소유 검증
  const existing = await prisma.finLiability.findFirst({
    where: { id, spaceId },
    select: { id: true },
  })
  if (!existing) return errorResponse('부채를 찾을 수 없습니다', 404)

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
