/**
 * 쿠팡 Open API 엔드포인트 래퍼
 *
 * path/파라미터는 developers.coupang.com/ko/api 문서를 확인해 넣었다(추측 금지).
 * 확인한 4종의 근거는 이 파일 각 함수 주석 및 팀 보고 참조.
 */
import { CoupangApiClient } from './client.js'

// ─── 로켓창고 재고 요약 (확인됨 — 계획서 §2-3에 명시된 path) ─────────────────────

export interface InventorySummaryItem {
  vendorId: string
  vendorItemId: number
  // 실측(Phase0) 결과 문자열이 아니라 숫자로 온다. DB text 컬럼과 비교하려면
  // 호출부에서 String() 정규화가 필수(worker/src/sources/inventory-api.ts 참조).
  externalSkuId: number | null
  /**
   * 수량은 평면 필드가 아니라 **중첩**으로 온다(Phase0 실측 §4):
   *   { "inventoryDetails": { "totalOrderableQuantity": 1 },
   *     "salesCountMap": { "SALES_COUNT_LAST_THIRTY_DAYS": 0 } }
   * 평면으로 선언하면 타입 에러 없이 undefined 가 되어 재고 수량이 통째로 null 로
   * 적재된다(실제로 그렇게 나가 대조가 skip:no-snapshot 으로 죽었다).
   * 직접 읽지 말고 아래 extractInventoryQuantities() 를 쓸 것.
   */
  inventoryDetails?: { totalOrderableQuantity?: number | null } | null
  salesCountMap?: { SALES_COUNT_LAST_THIRTY_DAYS?: number | null } | null
}

/**
 * 재고 요약 1건에서 수량을 뽑는다. 중첩 구조를 호출부마다 따로 풀면 한 곳만 놓쳐도
 * 무음으로 null 이 되므로 단일 진입점으로 둔다.
 */
export function extractInventoryQuantities(item: InventorySummaryItem): {
  orderableQuantity: number | null
  salesQty30d: number | null
} {
  return {
    orderableQuantity: item.inventoryDetails?.totalOrderableQuantity ?? null,
    salesQty30d: item.salesCountMap?.SALES_COUNT_LAST_THIRTY_DAYS ?? null,
  }
}

interface InventorySummaryResponse {
  code: number
  message: string
  nextToken?: string
  data: InventorySummaryItem[]
}

/**
 * 로켓창고 재고 요약 전량 조회.
 * GET /v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/inventory/summaries
 */
export async function fetchInventorySummaries(
  client: CoupangApiClient,
  vendorId: string
): Promise<InventorySummaryItem[]> {
  const path = `/v2/providers/rg_open_api/apis/api/v1/vendors/${vendorId}/rg/inventory/summaries`
  return client.paginate<InventorySummaryItem, InventorySummaryResponse>(
    path,
    undefined,
    (res) => ({
      items: res.data ?? [],
      nextToken: res.nextToken,
    })
  )
}

// ─── 로켓그로스 주문 목록 (WebFetch 로 문서 확인 — 아래 참조) ─────────────────────
// https://developers.coupang.com/ko/api/rocket-growth/rg-order-apilist-query
// GET /v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/orders
// 필수: vendorId, paidDateFrom(yyyymmdd), paidDateTo(yyyymmdd, 최대 30일 범위) / 선택: nextToken
// 분당 50회 제한.

export interface RgOrderItem {
  vendorItemId: number
  productName: string
  salesQuantity: number
  unitSalesPrice: number
  currency: string
}

export interface RgOrder {
  orderId: number
  vendorId: string
  paidAt: string
  orderItems: RgOrderItem[]
}

interface RgOrderListResponse {
  code: number
  message: string
  data: RgOrder[]
  nextToken?: string
}

/**
 * 로켓그로스 주문 목록 조회(최대 30일 범위, paidDateFrom/To 는 yyyymmdd).
 */
export async function fetchRgOrders(
  client: CoupangApiClient,
  vendorId: string,
  paidDateFrom: string,
  paidDateTo: string
): Promise<RgOrder[]> {
  const path = `/v2/providers/rg_open_api/apis/api/v1/vendors/${vendorId}/rg/orders`
  return client.paginate<RgOrder, RgOrderListResponse>(
    path,
    { vendorId, paidDateFrom, paidDateTo },
    (res) => ({ items: res.data ?? [], nextToken: res.nextToken })
  )
}

// ─── 정산: 매출내역(revenue-history) (WebFetch 로 문서 확인) ─────────────────────
// https://developers.coupang.com/ko/api/settlement/sales-detail-query
// GET /v2/providers/openapi/apis/api/v1/revenue-history
// 필수: vendorId, recognitionDateFrom/To(YYYY-MM-dd, 최대 31일), token(첫 페이지는 빈 문자열)
// 선택: maxPerPage(기본 50, 1~50)

export interface RevenueHistoryItem {
  orderId: number
  saleType: string
  saleDate: string
  recognitionDate: string
  settlementDate: string
  finalSettlementDate: string
  items: Array<{
    taxType: string
    productId: number
    productName: string
    vendorItemId: number
    vendorItemName: string
    salePrice: number
    quantity: number
    serviceFee: number
    settlementAmount: number
  }>
}

interface RevenueHistoryResponse {
  code: number
  message: string
  data: RevenueHistoryItem[]
  hasNext?: boolean
  nextToken?: string
}

/** 정산 매출내역 조회(최대 31일 범위). */
export async function fetchRevenueHistory(
  client: CoupangApiClient,
  vendorId: string,
  recognitionDateFrom: string,
  recognitionDateTo: string
): Promise<RevenueHistoryItem[]> {
  const path = '/v2/providers/openapi/apis/api/v1/revenue-history'
  return client.paginate<RevenueHistoryItem, RevenueHistoryResponse>(
    path,
    // 이 API 는 페이징 토큰 이름이 'token' 이다(다른 계열은 'nextToken').
    // 첫 페이지는 token='' 로 시작한다 — 생략하면 400 "token cannot be null".
    { vendorId, recognitionDateFrom, recognitionDateTo },
    (res) => ({ items: res.data ?? [], nextToken: res.nextToken }),
    undefined,
    'token'
  )
}

// ─── 정산: 지급내역(settlement-histories) (WebFetch 로 문서 확인) ────────────────
// https://developers.coupang.com/ko/api/settlement/settlement-detail-query
// GET /v2/providers/marketplace_openapi/apis/api/v1/settlement-histories
// 필수: revenueRecognitionYearMonth(YYYY-MM). 페이징 파라미터 없음(월 단위 단건 조회로 보임).

export interface SettlementHistoryItem {
  settlementType: string
  settlementDate: string
  revenueRecognitionYearMonth: string
  totalSale: number
  serviceFee: number
  settlementTargetAmount: number
  settlementAmount: number
  finalAmount: number
  status: string
  [key: string]: unknown
}

interface SettlementHistoryResponse {
  code: number
  message: string
  data: SettlementHistoryItem[]
}

/** 정산 지급내역 조회(YYYY-MM 단위, nextToken 페이징 없음). */
export async function fetchSettlementHistories(
  client: CoupangApiClient,
  revenueRecognitionYearMonth: string
): Promise<SettlementHistoryItem[]> {
  const path = '/v2/providers/marketplace_openapi/apis/api/v1/settlement-histories'
  const res = await client.get<SettlementHistoryResponse>(path, { revenueRecognitionYearMonth })
  return res.data ?? []
}

// ─── 상품 목록 페이징 조회 (WebFetch 로 문서 확인) ────────────────────────────────
// https://developers.coupang.com/ko/api/rocket-growth/product-list-paging-query-rocket-growth-rocket-growthmarketplace-hybrid-products
// GET /v2/providers/seller_api/apis/api/v1/marketplace/seller-products
// 필수: vendorId / 선택: nextToken, maxPerPage(기본10,최대100), sellerProductId, sellerProductName,
//       status, manufacture, createdAt, businessTypes('rocketGrowth'로 로켓그로스만 필터)

export interface SellerProductItem {
  sellerProductId: number
  sellerProductName: string
  displayCategoryCode: string
  categoryId: number
  productId: number
  vendorId: string
  saleStartedAt: string
  saleEndedAt: string
  brand: string
  statusName: string
  createdAt: string
  registrationType: string
  items: Array<{ itemName: string; marketPlaceItem?: unknown; rocketGrowthItem?: unknown }>
}

interface SellerProductListResponse {
  code: string
  message: string
  nextToken?: string
  data: SellerProductItem[]
}

/**
 * 상품 목록 페이징 조회. businessTypes 기본값 'rocketGrowth' — 생략하면 마켓플레이스
 * 상품 68건만 오고 그 sellerProductId 는 재고 API 옵션과 거의 안 붙는다(Phase0 실측 부록).
 * rocketGrowth 로 넘기면 55건이 나오고 이게 DB productId 축과 맞는다.
 */
export async function fetchSellerProducts(
  client: CoupangApiClient,
  vendorId: string,
  opts: { businessTypes?: string; maxPerPage?: number } = {}
): Promise<SellerProductItem[]> {
  const path = '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products'
  return client.paginate<SellerProductItem, SellerProductListResponse>(
    path,
    {
      vendorId,
      businessTypes: opts.businessTypes ?? 'rocketGrowth',
      maxPerPage: opts.maxPerPage,
    },
    (res) => ({ items: res.data ?? [], nextToken: res.nextToken })
  )
}

// ─── 상품 단건 조회 (WebFetch 로 문서 확인 — 계획서 §B) ────────────────────────────
// GET /v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}
//
// ⚠️ 로켓그로스 상품의 vendorItemId 는 평면 items[].vendorItemId 가 아니라
// items[].rocketGrowthItemData.vendorItemId 에 중첩돼 있다. 동시운영 상품은
// items[].marketplaceItemData.vendorItemId 도 별도로 가진다. 평면 필드만 읽으면
// 에러 없이 조용히 0건이 나온다(실측에서 실제로 재현됨) — extractVendorItemIds() 가
// 세 자리를 모두 본다.

export interface SellerProductDetailItem {
  vendorItemId?: number
  // 옵션명 — 아이템 단위(=vendorItemId 단위) 속성. 위치와 무관하게 아이템 하나에 하나.
  itemName?: string
  rocketGrowthItemData?: { vendorItemId?: number } | null
  marketplaceItemData?: { vendorItemId?: number } | null
  [key: string]: unknown
}

export interface SellerProductDetail {
  sellerProductId: number
  // 상품명(=productId 단위 속성). team-lead 반려 후 productName 이력 역산 보강용으로 사용.
  sellerProductName?: string
  items: SellerProductDetailItem[]
  [key: string]: unknown
}

interface SellerProductDetailResponse {
  code: number | string
  message: string
  data: SellerProductDetail
}

/** 상품 단건 조회 — items[] 에 vendorItemId 가 (평면/로켓그로스/마켓플레이스) 세 자리로 나뉘어 있다. */
export async function fetchSellerProduct(
  client: CoupangApiClient,
  sellerProductId: number | string
): Promise<SellerProductDetail> {
  const path = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${sellerProductId}`
  const res = await client.get<SellerProductDetailResponse>(path)
  return res.data
}

/** optionId(=vendorItemId) 와 그 아이템의 옵션명(itemName). */
export interface OptionIdentity {
  optionId: string
  optionName: string | null
}

/**
 * 상품 단건 조회 응답에서 optionId(=vendorItemId)·optionName(=itemName) 을 모두 뽑는다.
 * 평면(items[].vendorItemId) / 로켓그로스(items[].rocketGrowthItemData.vendorItemId) /
 * 마켓플레이스(items[].marketplaceItemData.vendorItemId) 세 자리를 전부 본다 —
 * 하나라도 빠지면 로켓그로스 전용 상품에서 조용히 0건이 나온다. itemName 은 그 아이템(=item
 * 객체 하나) 소속이라 위치와 무관하게 같은 값을 쓴다.
 */
export function extractOptionIdentities(productDetail: SellerProductDetail): OptionIdentity[] {
  const results: OptionIdentity[] = []
  const seen = new Set<string>()
  for (const item of productDetail.items ?? []) {
    const optionName = typeof item.itemName === 'string' ? item.itemName : null
    const ids = [
      item.vendorItemId,
      item.rocketGrowthItemData?.vendorItemId,
      item.marketplaceItemData?.vendorItemId,
    ]
    for (const id of ids) {
      if (id == null) continue
      const optionId = String(id)
      if (seen.has(optionId)) continue
      seen.add(optionId)
      results.push({ optionId, optionName })
    }
  }
  return results
}

/**
 * 상품 단건 조회 응답에서 vendorItemId(=optionId) 만 뽑는다. extractOptionIdentities() 의
 * id-only 래퍼 — 이름이 필요 없는 호출부(단위테스트 등)용으로 남겨둔다.
 */
export function extractVendorItemIds(productDetail: SellerProductDetail): string[] {
  return extractOptionIdentities(productDetail).map((r) => r.optionId)
}
