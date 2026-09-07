/**
 * @jest-environment node
 */
import { isSameAnalysisContent, runAndSaveInventoryAnalysis } from '../inventory-analyzer'

const findFirstUpload = jest.fn()
const findManyExcluded = jest.fn()
const findManyRecords = jest.fn()
const findFirstAnalysis = jest.fn()
const createAnalysis = jest.fn()
const notifyInventoryAnalysis = jest.fn()

jest.mock('@/lib/prisma', () => ({
  prisma: {
    inventoryUpload: { findFirst: (...a: unknown[]) => findFirstUpload(...a) },
    inventoryExcludedProduct: { findMany: (...a: unknown[]) => findManyExcluded(...a) },
    inventoryRecord: { findMany: (...a: unknown[]) => findManyRecords(...a) },
    inventoryAnalysis: {
      findFirst: (...a: unknown[]) => findFirstAnalysis(...a),
      create: (...a: unknown[]) => createAnalysis(...a),
    },
  },
}))
jest.mock('@/lib/slack-inventory-notifier', () => ({
  notifyInventoryAnalysis: (...a: unknown[]) => notifyInventoryAnalysis(...a),
  notifyInventoryStaleData: jest.fn(),
}))

// 재고 부족 1건이 나오도록 만든 최소 레코드 — 가용 0, 30일 판매 30개, 입고 예정 없음.
function shortageRecord(snapshotDate: Date) {
  return {
    snapshotDate,
    productName: '테스트 상품',
    optionName: '옵션 A',
    optionId: 'OPT-1',
    availableStock: 0,
    salesQty30d: 30,
    inboundStock: 0,
    returns30d: 0,
    storageFee: 0,
    revenue30d: 0,
    isWinner: true,
    fileType: 'INVENTORY_HEALTH',
  }
}

describe('isSameAnalysisContent', () => {
  const base = {
    shortageCount: 65,
    returnRateCount: 19,
    storageFeeCount: 0,
    winnerIssueCount: 17,
    results: { stockShortage: [{ optionId: 'A' }] },
  }

  it('카운트·results가 모두 같으면 동일', () => {
    expect(isSameAnalysisContent(base, { ...base, results: { stockShortage: [{ optionId: 'A' }] } })).toBe(true)
  })

  it('카운트가 하나라도 다르면 다름 (같은 날 수집이 늘어난 경우)', () => {
    expect(isSameAnalysisContent(base, { ...base, shortageCount: 66 })).toBe(false)
  })

  it('카운트가 같아도 results 내용이 다르면 다름', () => {
    expect(isSameAnalysisContent(base, { ...base, results: { stockShortage: [{ optionId: 'B' }] } })).toBe(false)
  })

  it('키 순서만 다르면 동일 — jsonb 저장 시 키가 재정렬된다', () => {
    const fresh = {
      ...base,
      results: {
        stockShortage: [{ productName: '상품', optionName: '옵션', optionId: 'A' }],
        returnRate: [],
      },
    }
    // Postgres jsonb가 길이 → 사전순으로 재정렬해 돌려준 형태.
    const fromDb = {
      ...base,
      results: {
        returnRate: [],
        stockShortage: [{ optionId: 'A', optionName: '옵션', productName: '상품' }],
      },
    }
    expect(isSameAnalysisContent(fromDb, fresh)).toBe(true)
  })
})

describe('runAndSaveInventoryAnalysis — Slack 중복 발송 방지', () => {
  const snapshotDate = new Date()

  beforeEach(() => {
    jest.clearAllMocks()
    findFirstUpload.mockResolvedValue({ snapshotDate })
    findManyExcluded.mockResolvedValue([])
    findManyRecords.mockResolvedValue([shortageRecord(snapshotDate)])
    createAnalysis.mockResolvedValue({ id: 'a1', analysedAt: new Date() })
    notifyInventoryAnalysis.mockResolvedValue(true)
  })

  it('같은 snapshotDate의 첫 분석은 발송한다', async () => {
    findFirstAnalysis.mockResolvedValue(null) // 직전 분석 없음

    const result = await runAndSaveInventoryAnalysis({
      workspaceId: 'ws1',
      triggeredBy: 'worker',
      sendSlack: true,
    })

    expect(result).toMatchObject({ status: 'ok', slackAttempted: true, slackDelivered: true })
    expect(notifyInventoryAnalysis).toHaveBeenCalledTimes(1)
  })

  it('직전 분석과 내용이 같으면 발송하지 않는다', async () => {
    // 첫 실행 결과를 그대로 직전 분석으로 돌려준다.
    const first = await runAndSaveInventoryAnalysis({
      workspaceId: 'ws1',
      triggeredBy: 'worker',
      sendSlack: true,
    })
    expect(first).toMatchObject({ slackDelivered: true })

    const created = createAnalysis.mock.calls[0][0].data
    findFirstAnalysis.mockResolvedValue({
      shortageCount: created.shortageCount,
      returnRateCount: created.returnRateCount,
      storageFeeCount: created.storageFeeCount,
      winnerIssueCount: created.winnerIssueCount,
      results: created.results,
    })
    notifyInventoryAnalysis.mockClear()

    const second = await runAndSaveInventoryAnalysis({
      workspaceId: 'ws1',
      triggeredBy: 'worker',
      sendSlack: true,
    })

    expect(second).toMatchObject({ status: 'ok', slackAttempted: false, slackDelivered: false })
    expect(notifyInventoryAnalysis).not.toHaveBeenCalled()
  })

  it('직전 분석과 내용이 다르면 다시 발송한다 (같은 날 결과가 바뀐 경우)', async () => {
    findFirstAnalysis.mockResolvedValue({
      shortageCount: 999,
      returnRateCount: 0,
      storageFeeCount: 0,
      winnerIssueCount: 0,
      results: { stockShortage: [], returnRate: [], storageFee: [], winnerStatus: [] },
    })

    await runAndSaveInventoryAnalysis({
      workspaceId: 'ws1',
      triggeredBy: 'worker',
      sendSlack: true,
    })

    expect(notifyInventoryAnalysis).toHaveBeenCalledTimes(1)
  })
})
