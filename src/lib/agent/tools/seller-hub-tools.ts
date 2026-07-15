import { z } from 'zod'
import { resolveMcpDeckContext } from '@/lib/mcp/context'
import {
  querySalesSummary,
  queryStockStatus,
  queryReorderStatus,
  queryProductRanking,
} from '@/lib/sh/queries'
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
    '재고 현황을 반환합니다. KPI(총 SKU/수량/재고가치/부족 SKU), 재고 건전성 분포, 브랜드→그룹 트리, 위치별 집계, 상품 단위 롤업(정상/부족/결품/과잉 옵션 수), SKU×위치 매트릭스(matrix.rows)를 포함합니다. 필터(brandId/groupId/productId/q/onlyLow)는 matrix.rows에만 적용됩니다. onlyLow=true면 부족·결품(LOW/OUT)만 남깁니다.',
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

export const sellerHubTools: ToolDefinition[] = [
  sellerHubGetSalesSummaryTool,
  sellerHubGetStockStatusTool,
  sellerHubGetReorderStatusTool,
  sellerHubGetProductRankingTool,
]
