// 재고 대조 데이터 소스 어댑터 — 파일 업로드 외 다른 Deck/외부 데이터를
// ParsedRow[] 로 변환하여 기존 대조 파이프라인(matcher/processor)에 투입한다.
import { prisma } from '@/lib/prisma'
import type { ParseResult } from '@/lib/inv/reconciliation-parser'

export type ReconciliationSource = 'coupang'

/**
 * 쿠팡 광고 Deck의 로켓그로스 재고(InventoryRecord)를 ParsedRow[] 로 변환한다.
 *
 * - Workspace ↔ Space 직접 연결이 없으므로, 호출자는 "현재 유저가 소유한
 *   쿠팡 Workspace" 를 미리 해석해 workspaceId 로 넘긴다.
 * - externalCode 우선순위(skuId ?? optionId ?? productId)는
 *   reconciliation-parser.ts 의 coupang_health 파서와 **동일 규칙**을 유지한다.
 *   (어긋나면 기존 InvLocationProductMap 매핑이 깨짐)
 * - quantity 는 판매가능재고(availableStock). null 행은 파일 파서와 동일하게 skip.
 */
export async function getCoupangInventoryRows(
  workspaceId: string,
  opts: { snapshotDate?: Date } = {}
): Promise<ParseResult> {
  // 1. 사용할 스냅샷 결정 — 지정값 우선, 없으면 최신 INVENTORY_HEALTH 업로드
  let targetDate: Date | undefined = opts.snapshotDate
  if (!targetDate) {
    const latest = await prisma.inventoryUpload.findFirst({
      where: { workspaceId, fileType: 'INVENTORY_HEALTH' },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    targetDate = latest?.snapshotDate
  }

  if (!targetDate) {
    // 수집된 쿠팡 재고 스냅샷이 전혀 없음
    return { format: 'coupang_health', rows: [], snapshotDate: undefined }
  }

  // 2. 해당 스냅샷의 재고 레코드 조회
  const records = await prisma.inventoryRecord.findMany({
    where: { workspaceId, snapshotDate: targetDate, fileType: 'INVENTORY_HEALTH' },
    select: {
      productId: true,
      optionId: true,
      skuId: true,
      productName: true,
      optionName: true,
      availableStock: true,
    },
  })

  // 3. ParsedRow 매핑 — 파일 파서와 동일 규칙
  const rows = records.flatMap((r) => {
    const externalCode = r.skuId ?? r.optionId ?? r.productId
    if (!externalCode) return []
    if (r.availableStock == null) return []
    return [
      {
        externalCode,
        externalName: r.productName ?? undefined,
        externalOptionName: r.optionName ?? undefined,
        quantity: r.availableStock,
      },
    ]
  })

  return { format: 'coupang_health', rows, snapshotDate: targetDate }
}
