// 쿠팡 재고 API productId/productName/optionName 해석기 (Phase0 실측 리포트 부록 확정 규칙 +
// team-lead 반려 후 확장: productName 플레이스홀더 대신 이력 역산으로 실제 값을 채운다)
//
// 재고 API(rg/inventory/summaries)는 productId 도 상품명도 주지 않는다(vendorItemId/
// externalSkuId/수량뿐). InventoryRecord unique 키(workspaceId, snapshotDate, productId,
// optionId, fileType)와 NOT NULL productName 을 채우려면 optionId(=vendorItemId) 로부터
// productId·productName·optionName 을 역산해야 한다.
//
// 확정 규칙 (실측: 이력 489/494 99.0% + 상품API 388/494 78.5% → 합집합 494/494 100%, 교차검증
// 불일치 0건). productName 도 productId 와 동일 커버리지·동일 옵션 집합으로 이력에서 나온다
// (실측: 494개 중 이력에서 productName 확보 489, 그중 optionName 도 489 — productId 와 동일):
//   1) InventoryRecord 이력에서 optionId -> {productId, productName, optionName}
//      (fileType 무관 — HEALTH+VENDOR 전체, 옵션당 최신 스냅샷 값 채택)
//   2) 이력에 없는 것만, 호출자가 넘긴 apiMap(상품 API 매핑)으로 보강
//   3) 그래도 productId+productName 이 모두 안 채워지면 unresolved — 적재에서 제외하고 경고
//      (플레이스홀더로 억지로 채우지 않는다 — productName 은 재고현황·대조 화면에 그대로
//      노출되고 InvLocationProductMap 미매칭 다이얼로그의 구별 근거이기도 하다)
import { prisma } from '@/lib/prisma'

export type ResolvedOptionIdentity = {
  productId: string
  productName: string
  optionName: string | null
}

/** apiMap 엔트리 — 상품 API(목록→단건 순회)로 확보한 보강 매핑. worker/src/coupang-api/product-map.ts 산출물과 동일 모양. */
export type ApiOptionIdentity = {
  productId: string
  productName: string | null
  optionName: string | null
}

export type ResolveOptionIdentityResult = {
  /** optionId -> {productId, productName, optionName} */
  resolved: Map<string, ResolvedOptionIdentity>
  /** 이력에도 apiMap 에도 productId+productName 이 모두 갖춰지지 않은 optionId */
  unresolved: string[]
}

/**
 * optionId(=vendorItemId) 배열을 받아 productId/productName/optionName 을 해석한다.
 *
 * 이력 조회는 옵션 수가 수백 개이므로 `optionId IN (...)` 한 방으로 끝낸다(N+1 금지).
 * optionId -> productId 는 실측상 1:1로 안정적(충돌 0건)이므로, 같은 optionId 에 여러
 * 이력이 있어도 가장 최근 스냅샷 값을 채택한다.
 */
export async function resolveOptionIdentity(
  workspaceId: string,
  optionIds: string[],
  apiMap?: Record<string, ApiOptionIdentity>
): Promise<ResolveOptionIdentityResult> {
  const resolved = new Map<string, ResolvedOptionIdentity>()
  if (optionIds.length === 0) return { resolved, unresolved: [] }

  const uniqueOptionIds = [...new Set(optionIds)]

  // 1) 이력 역산 — fileType 무관(HEALTH+VENDOR) 전체를 봐야 커버리지가 96.8%→99.0%로 오른다.
  //    옵션당 최신 스냅샷 값을 채택(snapshotDate desc 로 정렬해 먼저 만나는 값만 채택).
  const history = await prisma.inventoryRecord.findMany({
    where: { workspaceId, optionId: { in: uniqueOptionIds } },
    select: {
      optionId: true,
      productId: true,
      productName: true,
      optionName: true,
      snapshotDate: true,
    },
    orderBy: { snapshotDate: 'desc' },
  })
  for (const row of history) {
    if (resolved.has(row.optionId)) continue
    // productName 은 스키마상 NOT NULL 이라 이력에 있는 행이면 항상 채워져 있다.
    resolved.set(row.optionId, {
      productId: row.productId,
      productName: row.productName,
      optionName: row.optionName,
    })
  }

  // 2) 이력에 없는 것만 apiMap(상품 API 매핑)으로 보강 — productId+productName 이 모두
  //    있어야 채택한다(부분 정보로는 재고현황 화면에 상품명 없는 행을 만들지 않는다).
  const unresolved: string[] = []
  for (const optionId of uniqueOptionIds) {
    if (resolved.has(optionId)) continue
    const fromApi = apiMap?.[optionId]
    if (fromApi?.productId && fromApi.productName) {
      resolved.set(optionId, {
        productId: fromApi.productId,
        productName: fromApi.productName,
        optionName: fromApi.optionName,
      })
    } else {
      unresolved.push(optionId)
    }
  }

  return { resolved, unresolved }
}
