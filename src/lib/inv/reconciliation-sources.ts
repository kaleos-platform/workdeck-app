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
  // InventoryUpload.snapshotDate 는 워커 업로드 시점의 정확한 timestamp(예: 2026-05-22T14:58:01.626Z).
  // 클라이언트가 보낸 snapshotDate 는 사용자가 고른 KST 자정 (예: 2026-05-23T00:00:00Z) 이라 timestamp 가 완전히 다르다.
  // 따라서 지정값이 있으면 "해당 KST 일자에 수집된 가장 최근 업로드"를 찾아 그 정확한 timestamp 를 record 조회 키로 사용한다.
  let targetDate: Date | undefined
  if (opts.snapshotDate) {
    // KST 일자 [00:00, 24:00) 범위 = UTC [전날 15:00, 당일 15:00)
    const startUtc = new Date(opts.snapshotDate.getTime() - 9 * 3600 * 1000)
    const endUtc = new Date(startUtc.getTime() + 24 * 3600 * 1000)
    const onDay = await prisma.inventoryUpload.findFirst({
      where: {
        workspaceId,
        fileType: 'INVENTORY_HEALTH',
        snapshotDate: { gte: startUtc, lt: endUtc },
      },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    targetDate = onDay?.snapshotDate
  } else {
    const latest = await prisma.inventoryUpload.findFirst({
      where: { workspaceId, fileType: 'INVENTORY_HEALTH' },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    targetDate = latest?.snapshotDate
  }

  if (!targetDate) {
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
