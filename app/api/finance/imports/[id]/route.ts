/**
 * DELETE /api/finance/imports/[id]?includeTransactions=0|1
 * 업로드 파일 단위 일괄삭제 — 스테이징 행(cascade) + 선택 시 저장된 거래까지 삭제.
 *   - includeTransactions=1: 이 임포트에서 저장된 FinTransaction도 삭제 + DERIVED 스냅샷 재계산.
 *     (FinTransaction.import는 SetNull이므로 임포트 삭제 전에 거래를 먼저 지운다)
 * 보안: spaceId 소유 검증 후 처리.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { rebuildDerivedSnapshots } from '@/lib/finance/snapshot-rebuild'

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const { id } = await ctx.params
  const includeTransactions = req.nextUrl.searchParams.get('includeTransactions') === '1'

  const imp = await prisma.finImport.findFirst({ where: { id, spaceId }, select: { id: true } })
  if (!imp) return errorResponse('업로드 이력을 찾을 수 없습니다', 404)

  let deletedStaged = 0
  let deletedTransactions = 0

  await prisma.$transaction(
    async (tx) => {
      if (includeTransactions) {
        const targets = await tx.finTransaction.findMany({
          where: { importId: id, spaceId },
          select: { accountId: true },
        })
        const affectedAccounts = [...new Set(targets.map((t) => t.accountId))]
        const res = await tx.finTransaction.deleteMany({ where: { importId: id, spaceId } })
        deletedTransactions = res.count
        await rebuildDerivedSnapshots(tx, spaceId, affectedAccounts)
      }

      deletedStaged = await tx.finStagedRow.count({ where: { importId: id, spaceId } })
      await tx.finImport.delete({ where: { id } })
    },
    { timeout: 30000, maxWait: 10000 }
  )

  return NextResponse.json({ deletedStaged, deletedTransactions })
}
