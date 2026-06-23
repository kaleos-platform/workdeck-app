import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { toNum, toNumOrNull } from '@/lib/finance/serialize'

// 조회: spaceId 기준 부채 전체 (createdAt asc)
export async function GET() {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const liabilities = await prisma.finLiability.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({
    liabilities: liabilities.map((l) => ({
      ...l,
      principal: toNum(l.principal),
      balance: toNum(l.balance),
      monthlyPayment: toNumOrNull(l.monthlyPayment),
    })),
  })
}

// 생성: 부채 추가
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const body = await req.json().catch(() => ({}))
  const { name, lender, principal, balance, rate, dueDate, monthlyPayment, memo } = body as {
    name?: string
    lender?: string
    principal?: number
    balance?: number
    rate?: string
    dueDate?: string
    monthlyPayment?: number
    memo?: string
  }

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return errorResponse('부채 이름이 필요합니다', 400)
  }
  if (principal == null || typeof principal !== 'number') {
    return errorResponse('원금(principal)이 필요합니다', 400)
  }
  if (balance == null || typeof balance !== 'number') {
    return errorResponse('잔액(balance)이 필요합니다', 400)
  }

  const liability = await prisma.finLiability.create({
    data: {
      spaceId,
      name: name.trim(),
      lender: lender?.trim() ?? null,
      principal,
      balance,
      rate: rate ?? null,
      dueDate: dueDate ?? null,
      monthlyPayment: monthlyPayment ?? null,
      memo: memo?.trim() ?? null,
    },
  })

  return NextResponse.json(
    {
      liability: {
        ...liability,
        principal: toNum(liability.principal),
        balance: toNum(liability.balance),
        monthlyPayment: toNumOrNull(liability.monthlyPayment),
      },
    },
    { status: 201 }
  )
}
