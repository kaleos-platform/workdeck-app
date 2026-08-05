import { z } from 'zod'
import { resolveMcpDeckContext } from '@/lib/mcp/context'
import {
  querySalesSummary,
  queryStockStatus,
  queryReorderStatus,
  queryProductRanking,
} from '@/lib/sh/queries'
import { queryProductOptions } from '@/lib/sh/product-options-query'
import { queryProductMargin } from '@/lib/sh/margin-query'
import type { ToolDefinition } from './types'

const DECK = 'seller-hub'

/**
 * 브랜드 운영(seller-hub) Deck 조회(read) tool 4종.
 * route와 동일한 queries.ts 함수를 공유한다.
 * resolveMcpDeckContext가 비멤버/비활성 deck 시 throw → route.ts의 try/catch가 isError로 변환.
 */

/** GET /api/sh/dashboard/sales-summary 대응 — 판매 요약(MTD vs 지난달 동기간 + 최근 30일 + 브랜드별). */
const sellerHubGetSalesSummaryTool: ToolDefinition = {
  name: 'sellerhub_get_sales_summary',
  description:
    '판매 요약을 반환합니다. 이번달 누적(MTD) vs 지난달 동기간의 총매출·총주문(증감% 포함)과 최근 30일 매출·주문, 브랜드별 주문수·판매량·주문 증감%를 포함합니다. 기간은 현재 시각(KST) 기준으로 자동 산정됩니다.',
  inputSchema: {},
  mode: 'read',
  async execute(ctx) {
    const { space } = await resolveMcpDeckContext(ctx.userId, DECK)
    return querySalesSummary(space.id)
  },
}

/** GET /api/sh/inventory/stock-status 대응 — 재고 현황(KPI·브랜드 트리·위치·상품 롤업·SKU×위치 매트릭스). */
const sellerHubGetStockStatusTool: ToolDefinition = {
  name: 'sellerhub_get_stock_status',
  description:
    '재고 현황 전체를 반환합니다. KPI(총 SKU/수량/재고가치/부족 SKU), 재고 건전성 분포, 브랜드→그룹 트리, 위치별 집계, 상품 단위 롤업(정상/부족/결품/과잉 옵션 수), SKU×위치 매트릭스(matrix.rows)를 포함합니다. 필터(brandId/groupId/productId/q/onlyLow)는 matrix.rows에만 적용되며 나머지 집계는 항상 전체 기준이라 응답이 큽니다. 특정 상품의 SKU/옵션 목록만 필요하면 sellerhub_get_product_options를 쓰세요(응답이 훨씬 작고 옵션별 원가·재고·채널 판매가를 포함).',
  inputSchema: {
    brandId: z.string().optional(),
    groupId: z.string().optional(),
    productId: z.string().optional(),
    q: z.string().optional(),
    onlyLow: z.boolean().optional(),
  },
  mode: 'read',
  async execute(ctx, params) {
    const { space } = await resolveMcpDeckContext(ctx.userId, DECK)
    return queryStockStatus(space.id, {
      brandId: params.brandId as string | undefined,
      groupId: params.groupId as string | undefined,
      productId: params.productId as string | undefined,
      q: params.q as string | undefined,
      onlyLow: params.onlyLow as boolean | undefined,
    })
  },
}

/** GET /api/sh/dashboard/reorder-status 대응 — 초안 발주 + 예측 검증(ELIGIBLE/MEASURED) 롤업. */
const sellerHubGetReorderStatusTool: ToolDefinition = {
  name: 'sellerhub_get_reorder_status',
  description:
    '발주 계획 현황을 반환합니다. 초안(DRAFT) 발주 계획 수와 샘플(최대 5건), 예측 검증 계획 수(ELIGIBLE=정산 대기, MEASURED=최근 결과)를 계획 단위로 집계해 포함합니다.',
  inputSchema: {},
  mode: 'read',
  async execute(ctx) {
    const { space } = await resolveMcpDeckContext(ctx.userId, DECK)
    return queryReorderStatus(space.id)
  },
}

/** GET /api/sh/dashboard/product-ranking 대응 — 최근 30일 주문건수 기준 상위/부진 상품(각 5개). */
const sellerHubGetProductRankingTool: ToolDefinition = {
  name: 'sellerhub_get_product_ranking',
  description:
    '최근 30일 주문건수 기준 상위 상품(top 5)과 부진 상품(bottom 5)을 반환합니다. 상위는 직접배송 채널 주문건수 desc, 부진은 활성 상품 카탈로그를 대상으로 주문건수 asc(0판매 포함, 로켓그로스 판매 상품은 제외)입니다. window(집계 기간)도 함께 반환합니다.',
  inputSchema: {},
  mode: 'read',
  async execute(ctx) {
    const { space } = await resolveMcpDeckContext(ctx.userId, DECK)
    return queryProductRanking(space.id)
  },
}

/** SKU/옵션 단위 조회 — 재고·원가는 내부 옵션 기준, 채널은 판매가에만 관여. */
const sellerHubGetProductOptionsTool: ToolDefinition = {
  name: 'sellerhub_get_product_options',
  description:
    '상품의 SKU/옵션 목록만 반환합니다. 각 옵션의 skuCode·옵션명·옵션값(size/color/package/type)·재고수량·재고가치·단위원가(VAT 제외)·안전재고와 판매채널별 판매가(salesChannels: 채널·리스팅·판매가·단가환산·수수료율·수수료액)를 포함합니다. productId 또는 q(상품명·관리명·옵션명·SKU 검색)로 좁히세요. page/pageSize(기본 10, 최대 200)로 페이지네이션하며 summary와 rows가 분리되어 있습니다. 옵션 1건이 채널 리스팅 전체를 싣기 때문에 기본값이 작습니다 — 옵션이 많은 상품은 nextCursor(다음에 읽을 절대 오프셋)를 offset 인자로 넘겨 이어서 받으세요. 응답이 50KB를 넘으면 rows가 잘리고 summary.truncatedForSize=true가 됩니다. 스키마에 없는 필드는 null이 아니라 missingFields 배열로 알려줍니다. 재고 전체 현황이 필요한 게 아니라면 sellerhub_get_stock_status 대신 이 tool을 쓰세요.',
  inputSchema: {
    productId: z.string().optional(),
    productIds: z.array(z.string()).optional(),
    q: z.string().optional(),
    page: z.number().optional(),
    pageSize: z.number().optional(),
    offset: z.number().optional(),
    includeInactive: z.boolean().optional(),
  },
  mode: 'read',
  async execute(ctx, params) {
    const { space } = await resolveMcpDeckContext(ctx.userId, DECK)
    return queryProductOptions(space.id, {
      productId: params.productId as string | undefined,
      productIds: params.productIds as string[] | undefined,
      q: params.q as string | undefined,
      page: params.page as number | undefined,
      pageSize: params.pageSize as number | undefined,
      offset: params.offset as number | undefined,
      includeInactive: params.includeInactive as boolean | undefined,
    })
  },
}

/** 옵션 단위 공헌이익 — finance/ads 지표를 SKU 기준으로 합류시킨다. */
const sellerHubGetProductMarginTool: ToolDefinition = {
  name: 'sellerhub_get_product_margin',
  description:
    '기간(from~to, YYYY-MM-DD KST)의 SKU/옵션 단위 공헌이익을 반환합니다. 옵션별 revenue·cogs·shippingCost·packagingCost·commissionFee·adCost·contributionProfit·contributionMarginRatio를 계산합니다. 매출은 직접배송(DelOrder)과 쿠팡 로켓그로스 두 경로를 합산하고, 광고비는 외부 옵션ID 브리지 → 캠페인↔상품 매핑 순으로 귀속합니다. 귀속에 실패한 금액은 옵션에 배분하지 않고 summary.unattributedRevenue·unallocatedAdCost로 분리하며, coverage에 경로별 귀속률을 함께 반환하니 수치 해석 시 반드시 확인하세요. productIds/optionIds/channel로 좁히고 page/pageSize(기본 50)로 페이지네이션합니다.',
  inputSchema: {
    from: z.string(),
    to: z.string(),
    productIds: z.array(z.string()).optional(),
    optionIds: z.array(z.string()).optional(),
    channel: z.string().optional(),
    page: z.number().optional(),
    pageSize: z.number().optional(),
  },
  mode: 'read',
  async execute(ctx, params) {
    const { space } = await resolveMcpDeckContext(ctx.userId, DECK)
    return queryProductMargin(space.id, {
      from: params.from as string,
      to: params.to as string,
      productIds: params.productIds as string[] | undefined,
      optionIds: params.optionIds as string[] | undefined,
      channel: params.channel as string | undefined,
      page: params.page as number | undefined,
      pageSize: params.pageSize as number | undefined,
    })
  },
}

export const sellerHubTools: ToolDefinition[] = [
  sellerHubGetSalesSummaryTool,
  sellerHubGetStockStatusTool,
  sellerHubGetReorderStatusTool,
  sellerHubGetProductRankingTool,
  sellerHubGetProductOptionsTool,
  sellerHubGetProductMarginTool,
]
