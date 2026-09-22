// 재고 대조 데이터 소스 어댑터 — 파일 업로드 외 다른 Deck/외부 데이터를
// ParsedRow[] 로 변환하여 기존 대조 파이프라인(matcher/processor)에 투입한다.
import { prisma } from '@/lib/prisma'
import { getCoupangGradeIndex } from '@/lib/inv/coupang-return-stock'
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
  // 1. 사용할 스냅샷 결정 — 지정 일자(KST) 우선, 없으면 최신. 단 재고가 채워진 것만.
  // InventoryUpload.snapshotDate 는 워커 업로드 시점의 정확한 timestamp(예: 2026-05-22T14:58:01.626Z).
  // 클라이언트가 보낸 snapshotDate 는 사용자가 고른 KST 자정 (예: 2026-05-23T00:00:00Z) 이라 timestamp 가 완전히 다르다.
  // 따라서 지정값이 있으면 "해당 KST 일자에 수집된 가장 최근 업로드"를 찾아 그 정확한 timestamp 를 record 조회 키로 사용한다.
  // 완전성 baseline 은 이 스냅샷을 만든 업로드의 source 를 따라간다 — 크롤링 HEALTH 행과
  // API 요약 행은 모집단 자체가 다르므로(478 vs 494, Phase0 실측), source 를 안 가리면
  // baseline 을 공유해 첫 API 수집이 영구히 가드에 걸리거나 반대로 그냥 통과해 덮어쓴다.
  let targetSource: 'CRAWL' | 'API' = 'CRAWL'

  // 후보는 **재고가 실제로 채워진** 스냅샷으로 한정한다.
  // API 수집분은 식별자·상품명만 채우고 availableStock 을 안 실어 오는 경우가 있다
  // (2026-09-08 prod 실측: 494행 전부 null). 그런 스냅샷이 최신이면 아래 3단계에서
  // 전 행이 skip 되어 rows 0건 → 완전성 가드 → skip:incomplete-snapshot 으로
  // 자동 대조가 영구히 만들어지지 않는다. 업로드 테이블에는 재고 유무 정보가 없으므로
  // InventoryRecord 를 기준으로 고른다.
  const stockedRange = opts.snapshotDate
    ? (() => {
        // KST 일자 [00:00, 24:00) 범위 = UTC [전날 15:00, 당일 15:00)
        const startUtc = new Date(opts.snapshotDate.getTime() - 9 * 3600 * 1000)
        return { gte: startUtc, lt: new Date(startUtc.getTime() + 24 * 3600 * 1000) }
      })()
    : undefined
  const stocked = await prisma.inventoryRecord.aggregate({
    where: {
      workspaceId,
      fileType: 'INVENTORY_HEALTH',
      availableStock: { not: null },
      ...(stockedRange ? { snapshotDate: stockedRange } : {}),
    },
    _max: { snapshotDate: true },
  })
  const targetDate = stocked._max.snapshotDate ?? undefined

  // baseline 은 이 스냅샷을 만든 업로드의 source 를 따라간다.
  if (targetDate) {
    const upload = await prisma.inventoryUpload.findFirst({
      where: { workspaceId, fileType: 'INVENTORY_HEALTH', snapshotDate: targetDate },
      select: { source: true },
    })
    if (upload?.source) targetSource = upload.source
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
      // 반품 등급 구분용 — 파일 파서(parseCoupangHealth)의 '상품등급' 과 같은 값이어야 한다.
      productGrade: true,
    },
  })

  // 2-1. 등급 보완 — 선택된 스냅샷에 상품등급이 없으면 등급이 있는 최신 스냅샷에서 가져온다.
  // Open API 수집분은 재고는 주지만 상품등급을 안 준다. 그대로 두면 수집 경로가
  // API 로 바뀌는 순간 반품 구분이 화면에서 통째로 사라진다(2026-09-08 실측).
  const hasGrade = records.some((r) => r.productGrade != null)
  const gradeByCode = hasGrade ? null : await getCoupangGradeIndex(workspaceId)

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
        externalGrade: r.productGrade ?? gradeByCode?.get(externalCode) ?? undefined,
        quantity: r.availableStock,
      },
    ]
  })

  // 4. 완전성 판정 — 최근 10건 업로드의 insertedRows MAX 를 앵커로.
  //    (직전 1건만 보면 이미 적재된 부분 export 를 정상 baseline 으로 신뢰해 무력화된다)
  //    source 로 분리 조회 — inventory-upload-processor.ts 의 완전성 가드와 동일 원칙(위 주석 참조).
  const recent = await prisma.inventoryUpload.findMany({
    where: {
      workspaceId,
      fileType: 'INVENTORY_HEALTH',
      source: targetSource,
      insertedRows: { gt: 0 },
    },
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
