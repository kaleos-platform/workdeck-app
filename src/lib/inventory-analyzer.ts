import { prisma } from '@/lib/prisma'

// ─── 타입 정의 ──────────────────────────────────────────────────────────────────

export type StockShortageItem = {
  productName: string
  optionName: string | null
  optionId: string
  availableStock: number
  salesQty30d: number
  inboundStock: number
  requiredRestockQty: number
}

export type ReturnRateItem = {
  productName: string
  optionName: string | null
  optionId: string
  returns30d: number
  salesQty30d: number
  returnRatePct: number
}

export type StorageFeeItem = {
  productName: string
  optionName: string | null
  optionId: string
  storageFee: number
  revenue30d: number
  storageFeeRatioPct: number | null
  reason: 'NO_SALES_HIGH_STORAGE' | 'HIGH_RATIO'
}

export type WinnerStatusItem = {
  productName: string
  optionName: string | null
  optionId: string
  availableStock: number
}

export type InventoryAnalysisResults = {
  stockShortage: StockShortageItem[]
  returnRate: ReturnRateItem[]
  storageFee: StorageFeeItem[]
  winnerStatus: WinnerStatusItem[]
}

type AnalysisOutput = {
  snapshotDate: Date
  results: InventoryAnalysisResults
  shortageCount: number
  returnRateCount: number
  storageFeeCount: number
  winnerIssueCount: number
}

// ─── 분석 엔진 ──────────────────────────────────────────────────────────────────

export async function analyzeInventory(params: {
  workspaceId: string
  snapshotDate?: Date
}): Promise<AnalysisOutput | null> {
  const { workspaceId } = params

  // 1. 최신 INVENTORY_HEALTH 스냅샷 날짜 조회
  const latestUpload = await prisma.inventoryUpload.findFirst({
    where: { workspaceId, fileType: 'INVENTORY_HEALTH' },
    orderBy: { snapshotDate: 'desc' },
    select: { snapshotDate: true },
  })

  if (!latestUpload) return null

  const snapshotDate = params.snapshotDate ?? latestUpload.snapshotDate

  // 2. 제외 옵션 목록 조회
  const excludedOptions = await prisma.inventoryExcludedProduct.findMany({
    where: { workspaceId },
    select: { optionId: true },
  })
  const excludedOptionIds = excludedOptions.map((e) => e.optionId)

  // 3. 관리 상품 레코드 조회
  const records = await prisma.inventoryRecord.findMany({
    where: {
      workspaceId,
      snapshotDate,
      fileType: 'INVENTORY_HEALTH',
      ...(excludedOptionIds.length > 0 ? { optionId: { notIn: excludedOptionIds } } : {}),
    },
    select: {
      productName: true,
      optionName: true,
      optionId: true,
      availableStock: true,
      salesQty30d: true,
      inboundStock: true,
      returns30d: true,
      revenue30d: true,
      storageFee: true,
      isItemWinner: true,
    },
  })

  // 4. 분석 규칙 적용
  const stockShortage: StockShortageItem[] = []
  const returnRate: ReturnRateItem[] = []
  const storageFee: StorageFeeItem[] = []
  const winnerStatus: WinnerStatusItem[] = []

  for (const r of records) {
    const avail = r.availableStock ?? 0
    const sales = r.salesQty30d ?? 0
    const inbound = r.inboundStock ?? 0
    const returns = r.returns30d ?? 0
    const revenue = Number(r.revenue30d ?? 0)
    const storage = r.storageFee ?? 0

    // 재고 부족: 재고 - 판매 + 입고예정 <= 0
    if (avail - sales + inbound <= 0 && sales > 0) {
      stockShortage.push({
        productName: r.productName,
        optionName: r.optionName,
        optionId: r.optionId,
        availableStock: avail,
        salesQty30d: sales,
        inboundStock: inbound,
        requiredRestockQty: sales - inbound - avail,
      })
    }

    // 반품율: 10% 초과
    if (sales > 0 && returns > 0) {
      const pct = (returns / sales) * 100
      if (pct > 10) {
        returnRate.push({
          productName: r.productName,
          optionName: r.optionName,
          optionId: r.optionId,
          returns30d: returns,
          salesQty30d: sales,
          returnRatePct: Math.round(pct * 10) / 10,
        })
      }
    }

    // 보관료: (a) 매출 없고 보관료 5000원 이상 (b) 보관료율 10% 이상
    if (revenue === 0 && storage >= 5000) {
      storageFee.push({
        productName: r.productName,
        optionName: r.optionName,
        optionId: r.optionId,
        storageFee: storage,
        revenue30d: revenue,
        storageFeeRatioPct: null,
        reason: 'NO_SALES_HIGH_STORAGE',
      })
    } else if (revenue > 0 && storage > 0) {
      const ratio = (storage / revenue) * 100
      if (ratio >= 10) {
        storageFee.push({
          productName: r.productName,
          optionName: r.optionName,
          optionId: r.optionId,
          storageFee: storage,
          revenue30d: revenue,
          storageFeeRatioPct: Math.round(ratio * 10) / 10,
          reason: 'HIGH_RATIO',
        })
      }
    }

    // 위너 미달성: 재고 있는데 위너 아닌 경우
    if (avail > 0 && r.isItemWinner === false) {
      winnerStatus.push({
        productName: r.productName,
        optionName: r.optionName,
        optionId: r.optionId,
        availableStock: avail,
      })
    }
  }

  // 정렬
  stockShortage.sort((a, b) => b.requiredRestockQty - a.requiredRestockQty)
  returnRate.sort((a, b) => b.returnRatePct - a.returnRatePct)
  storageFee.sort((a, b) => b.storageFee - a.storageFee)
  winnerStatus.sort((a, b) => b.availableStock - a.availableStock)

  const results: InventoryAnalysisResults = { stockShortage, returnRate, storageFee, winnerStatus }

  return {
    snapshotDate,
    results,
    shortageCount: stockShortage.length,
    returnRateCount: returnRate.length,
    storageFeeCount: storageFee.length,
    winnerIssueCount: winnerStatus.length,
  }
}

// ─── 분석 실행 + 저장 ────────────────────────────────────────────────────────────

/**
 * snapshot 데이터를 KST 자정 기준 N일 이상 오래된 것으로 간주할지 여부.
 * 워커가 매일 새벽 수집하므로 2일 이상이면 stale.
 */
const STALE_THRESHOLD_DAYS = 2

function kstMidnight(d: Date): Date {
  const kst = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  kst.setHours(0, 0, 0, 0)
  return kst
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000)
}

export type RunAndSaveResult =
  | {
      status: 'ok'
      analysisId: string
      slackAttempted: boolean
      slackDelivered: boolean
    }
  | {
      status: 'skipped_stale'
      snapshotDate: Date
      ageDays: number
      slackAttempted: boolean
      slackDelivered: boolean
    }

export async function runAndSaveInventoryAnalysis(params: {
  workspaceId: string
  triggeredBy: string
  sendSlack?: boolean
  /** 수동 트리거(UI '재분석' 버튼)는 stale이어도 실행을 허용. 기본 false. */
  allowStale?: boolean
}): Promise<RunAndSaveResult | null> {
  const output = await analyzeInventory({ workspaceId: params.workspaceId })
  if (!output) return null

  // ── Stale 가드 ──
  const ageDays = daysBetween(kstMidnight(new Date()), kstMidnight(output.snapshotDate))
  const isStale = ageDays >= STALE_THRESHOLD_DAYS

  if (isStale && !params.allowStale) {
    // 분석 결과 row를 저장하지 않고 stale 알림만 dedupe해서 1회 전송.
    let slackAttempted = false
    let slackDelivered = false

    // DB marker dedupe — 같은 snapshotDate에 'stale-skip' marker가 이미 있으면 Slack 발송 생략
    const existingMarker = await prisma.inventoryAnalysis.findFirst({
      where: {
        workspaceId: params.workspaceId,
        snapshotDate: output.snapshotDate,
        triggeredBy: 'stale-skip',
      },
      select: { id: true },
    })

    if (params.sendSlack && !existingMarker) {
      slackAttempted = true
      try {
        const { notifyInventoryStaleData } = await import('@/lib/slack-inventory-notifier')
        slackDelivered = await notifyInventoryStaleData({
          snapshotDate: output.snapshotDate,
          ageDays,
        })
      } catch (err) {
        console.error('[inventory-analyzer] Slack stale 알림 실패:', err)
        slackDelivered = false
      }

      // dedupe marker 생성 (결과 없이 0건)
      await prisma.inventoryAnalysis.create({
        data: {
          workspaceId: params.workspaceId,
          snapshotDate: output.snapshotDate,
          triggeredBy: 'stale-skip',
          results: {} as object,
          shortageCount: 0,
          returnRateCount: 0,
          storageFeeCount: 0,
          winnerIssueCount: 0,
        },
      })
    }

    return {
      status: 'skipped_stale',
      snapshotDate: output.snapshotDate,
      ageDays,
      slackAttempted,
      slackDelivered,
    }
  }

  const analysis = await prisma.inventoryAnalysis.create({
    data: {
      workspaceId: params.workspaceId,
      snapshotDate: output.snapshotDate,
      triggeredBy: params.triggeredBy,
      results: output.results as object,
      shortageCount: output.shortageCount,
      returnRateCount: output.returnRateCount,
      storageFeeCount: output.storageFeeCount,
      winnerIssueCount: output.winnerIssueCount,
    },
  })

  let slackAttempted = false
  let slackDelivered = false

  if (params.sendSlack) {
    slackAttempted = true
    try {
      const { notifyInventoryAnalysis } = await import('@/lib/slack-inventory-notifier')
      slackDelivered = await notifyInventoryAnalysis({
        analysedAt: analysis.analysedAt,
        snapshotDate: output.snapshotDate,
        ageDays,
        results: output.results,
        shortageCount: output.shortageCount,
        returnRateCount: output.returnRateCount,
        storageFeeCount: output.storageFeeCount,
        winnerIssueCount: output.winnerIssueCount,
      })
    } catch (err) {
      console.error('[inventory-analyzer] Slack 알림 실패:', err)
      slackDelivered = false
    }
  }

  return { status: 'ok', analysisId: analysis.id, slackAttempted, slackDelivered }
}
