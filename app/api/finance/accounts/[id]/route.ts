import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { toNum, toNumOrNull } from '@/lib/finance/serialize'
import { accountBalanceAt } from '@/lib/finance/balance-trend'

// 수정: 계좌 부분 업데이트
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance', { write: true })
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
    status,
  } = body as {
    name?: string
    holder?: string | null
    institution?: string
    accountNumber?: string
    accountType?: string
    openingBalance?: number | null
    currentBalance?: number | null
    currentBalanceAsOf?: string | null
    status?: string
  }

  if (status !== undefined && status !== 'ACTIVE' && status !== 'INACTIVE') {
    return errorResponse('status는 ACTIVE 또는 INACTIVE여야 합니다', 400)
  }

  // spaceId 소유 검증
  const existing = await prisma.finAccount.findFirst({
    where: { id, spaceId },
    select: { id: true, accountNumber: true, kind: true, status: true, openingBalance: true },
  })
  if (!existing) return errorResponse('계좌를 찾을 수 없습니다', 404)

  // 미사용 전환 게이트 — 은행 계좌는 잔액 0일 때만. 잔액이 남은 채 빼면 현금·순자산이 조용히 틀어진다.
  // 잔액 기준은 대시보드 현금 합계와 같은 accountBalanceAt(최신 월말 스냅샷 → openingBalance).
  if (status === 'INACTIVE' && existing.status !== 'INACTIVE' && existing.kind === 'BANK') {
    const snaps = await prisma.finBalanceSnapshot.findMany({
      where: { spaceId, accountId: id },
      select: { yearMonth: true, balance: true },
      orderBy: { yearMonth: 'asc' },
    })
    const balance = accountBalanceAt(
      snaps.map((s) => ({ ym: s.yearMonth, balance: toNum(s.balance) })),
      '9999-12',
      toNumOrNull(existing.openingBalance)
    )
    if (balance !== 0) {
      return errorResponse(
        `잔액이 ${balance.toLocaleString('ko-KR')}원 남아 있습니다. 최종 거래내역을 업로드해 잔액을 0원으로 만든 뒤 미사용으로 변경하세요.`,
        409
      )
    }
  }

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
        ...(status !== undefined &&
          status !== existing.status && { status, statusChangedAt: new Date() }),
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
  const resolved = await resolveDeckContext('finance', { write: true })
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
