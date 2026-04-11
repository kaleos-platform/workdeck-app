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

export async function runAndSaveInventoryAnalysis(params: {
  workspaceId: string
  triggeredBy: string
  sendSlack?: boolean
}): Promise<{ analysisId: string } | null> {
  const output = await analyzeInventory({ workspaceId: params.workspaceId })
  if (!output) return null

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

  if (params.sendSlack) {
    const { notifyInventoryAnalysis } = await import('@/lib/slack-inventory-notifier')
    await notifyInventoryAnalysis({
      analysedAt: analysis.analysedAt,
      snapshotDate: output.snapshotDate,
      results: output.results,
      shortageCount: output.shortageCount,
      returnRateCount: output.returnRateCount,
      storageFeeCount: output.storageFeeCount,
      winnerIssueCount: output.winnerIssueCount,
    }).catch((err) => console.error('[inventory-analyzer] Slack 알림 실패:', err))
  }

  return { analysisId: analysis.id }
}
