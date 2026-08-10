// 재고 대조 데이터 소스 어댑터 — 파일 업로드 외 다른 Deck/외부 데이터를
// ParsedRow[] 로 변환하여 기존 대조 파이프라인(matcher/processor)에 투입한다.
import { prisma } from '@/lib/prisma'
import type { ParseResult } from '@/lib/inv/reconciliation-parser'

export type ReconciliationSource = 'coupang'

/**
 * 스냅샷 완전성 판정 — 부분 export(Wing 그리드 미완전 로드 상태 다운로드) 탐지.
 *
 * 업로드 단계(inventory-upload-processor.ts)에도 같은 가드가 있지만, 그 가드 도입
 * 이전에 적재된 부분 스냅샷은 DB 에 그대로 남아 있다. 자동 대조는 사람 검토를
 * 거치지 않으므로 소스 단계에서 한 번 더 판정한다.
 *
 * 판정만 하고 throw 하지 않는다 — 수동 대조는 사람이 미리보기로 확인하므로 기존대로
 * 통과시키고, cron 만 이 값을 보고 스킵한다.
 */
export type SnapshotCompleteness = {
  ok: boolean
  rowCount: number
  /** 최근 10건 INVENTORY_HEALTH 업로드의 insertedRows MAX. 이력이 없으면 0(판정 불가 → ok) */
  baseline: number
}

/** 업로드 단계 가드와 동일 임계 — 최근 최대 행수의 50% 미만이면 부분 export 의심 */
const COMPLETENESS_RATIO = 0.5

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
): Promise<ParseResult & { completeness: SnapshotCompleteness }> {
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
    return {
      format: 'coupang_health',
      rows: [],
      snapshotDate: undefined,
      completeness: { ok: false, rowCount: 0, baseline: 0 },
    }
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

  // 4. 완전성 판정 — 최근 10건 업로드의 insertedRows MAX 를 앵커로.
  //    (직전 1건만 보면 이미 적재된 부분 export 를 정상 baseline 으로 신뢰해 무력화된다)
  const recent = await prisma.inventoryUpload.findMany({
    where: { workspaceId, fileType: 'INVENTORY_HEALTH', insertedRows: { gt: 0 } },
    orderBy: { uploadedAt: 'desc' },
    take: 10,
    select: { insertedRows: true },
  })
  const baseline = recent.reduce((max, u) => Math.max(max, u.insertedRows ?? 0), 0)
  const completeness: SnapshotCompleteness = {
    ok: baseline === 0 || rows.length >= baseline * COMPLETENESS_RATIO,
    rowCount: rows.length,
    baseline,
  }

  return { format: 'coupang_health', rows, snapshotDate: targetDate, completeness }
}
