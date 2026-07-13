import { z } from 'zod'
import { resolveMcpDeckContext } from '@/lib/mcp/context'
import {
  queryCashflow,
  queryTransactions,
  queryAccounts,
  queryDashboard,
} from '@/lib/finance/queries'
import type { Grain } from '@/lib/finance/periods'
import type { ToolDefinition } from './types'

const DECK = 'finance'

/**
 * finance Deck 조회(read) tool 4종.
 * route와 동일한 queries.ts 함수를 공유한다.
 * resolveMcpDeckContext가 비멤버/비활성 deck 시 throw → route.ts의 try/catch가 isError로 변환.
 */

/** GET /api/finance/cashflow 대응 — 현금흐름 상세(기간별 수입/지출 리프 집계 + 합계). */
const financeGetCashflowTool: ToolDefinition = {
  name: 'finance_get_cashflow',
  description:
    '현금흐름 상세를 반환합니다. 기간(월/분기/연) 버킷별로 수입·지출을 운영 항목(리프) 단위로 집계하고, 수입/지출/순현금흐름 총계와 직전 기간 대비 증감%를 포함합니다.',
  inputSchema: {
    grain: z.enum(['month', 'quarter', 'year']).optional(),
    periods: z.array(z.string()).optional(),
  },
  mode: 'read',
  async execute(ctx, params) {
    const { space } = await resolveMcpDeckContext(ctx.userId, DECK)
    const grain = (params.grain as Grain | undefined) ?? 'month'
    const periods = params.periods as string[] | undefined
    return queryCashflow(space.id, { grain, periods })
  },
}

/** GET /api/finance/transactions 대응 — 확정 거래 목록 + 합계(take·total 포함). */
const financeListTransactionsTool: ToolDefinition = {
  name: 'finance_list_transactions',
  description:
    '확정 거래(FinTransaction) 목록과 합계를 반환합니다. 기간(from/to)·방향(IN/OUT)·분류상태·계정과목·검색어로 필터하며, take(기본 50)로 페이지네이션합니다. total(전체 건수)과 summary(수입/지출/순액)를 함께 반환합니다.',
  inputSchema: {
    from: z.string().optional(),
    to: z.string().optional(),
    direction: z.enum(['IN', 'OUT']).optional(),
    classStatus: z.string().optional(),
    q: z.string().optional(),
    categoryId: z.string().optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
    sort: z.string().optional(),
    order: z.enum(['asc', 'desc']).optional(),
  },
  mode: 'read',
  async execute(ctx, params) {
    const { space } = await resolveMcpDeckContext(ctx.userId, DECK)
    return queryTransactions(space.id, {
      from: params.from as string | undefined,
      to: params.to as string | undefined,
      direction: params.direction as string | undefined,
      classStatus: params.classStatus as string | undefined,
      q: params.q as string | undefined,
      categoryId: params.categoryId as string | undefined,
      sort: params.sort as string | undefined,
      order: (params.order as 'asc' | 'desc' | undefined) ?? 'desc',
      take: (params.take as number | undefined) ?? 50,
      skip: (params.skip as number | undefined) ?? 0,
    })
  },
}

/** GET /api/finance/accounts 대응 — 계좌 전체 목록. */
const financeListAccountsTool: ToolDefinition = {
  name: 'finance_list_accounts',
  description:
    '등록된 계좌(FinAccount) 전체 목록을 반환합니다. 각 계좌의 종류(BANK/CARD)·금융기관·계좌번호·기초잔액·현재잔액을 포함합니다.',
  inputSchema: {},
  mode: 'read',
  async execute(ctx) {
    const { space } = await resolveMcpDeckContext(ctx.userId, DECK)
    return queryAccounts(space.id)
  },
}

/** GET /api/finance/dashboard 대응 — 요약 대시보드 집계(KPI·추이·계좌잔고·지출Top·부채). */
const financeGetDashboardTool: ToolDefinition = {
  name: 'finance_get_dashboard',
  description:
    '재무 요약 대시보드 집계를 반환합니다. KPI(총현금/수입/지출/순현금흐름/순자산/총부채 + 전기 대비), 12개월 추이, 계좌별 잔고 스냅샷, 계정과목별 지출 Top, 부채 현황을 포함합니다. period(month/year)·anchor로 기간을 지정합니다.',
  inputSchema: {
    period: z.enum(['month', 'year']).optional(),
    anchor: z.string().optional(),
  },
  mode: 'read',
  async execute(ctx, params) {
    const { space } = await resolveMcpDeckContext(ctx.userId, DECK)
    const period = (params.period as 'month' | 'year' | undefined) ?? 'month'
    const anchor = params.anchor as string | undefined
    return queryDashboard(space.id, { period, anchor })
  },
}

export const financeTools: ToolDefinition[] = [
  financeGetCashflowTool,
  financeListTransactionsTool,
  financeListAccountsTool,
  financeGetDashboardTool,
]
