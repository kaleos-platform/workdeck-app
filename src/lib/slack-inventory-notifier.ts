/**
 * 재고 분석 결과 Slack 전송
 * worker/src/slack-notifier.ts와 동일한 패턴 사용
 */

import type { InventoryAnalysisResults } from '@/lib/inventory-analyzer'
import { sendDeckNotification, sendSystemNotification } from '@/lib/slack/send-notification'

// 재고 분석·수집 알림은 모두 쿠팡 광고 관리자 Deck 소속.
const DECK_KEY = 'coupang-ads'

type Block = {
  type: string
  text?: unknown
  fields?: unknown[]
  elements?: unknown[]
  [key: string]: unknown
}

// ─── Block Kit 헬퍼 ─────────────────────────────────────────────────────────

function header(text: string): Block {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } }
}

function divider(): Block {
  return { type: 'divider' }
}

function section(text: string): Block {
  return { type: 'section', text: { type: 'mrkdwn', text } }
}

function context(text: string): Block {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] }
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
}

function formatItems(items: Array<{ label: string }>, maxItems: number): string {
  const shown = items.slice(0, maxItems)
  const lines = shown.map((item) => `• ${item.label}`)
  if (items.length > maxItems) {
    lines.push(`  _+${items.length - maxItems}건 더_`)
  }
  return lines.join('\n')
}

// ─── 알림 전송 ──────────────────────────────────────────────────────────────

export async function notifyInventoryAnalysis(params: {
  workspaceId: string
  analysedAt: Date
  snapshotDate: Date
  /** snapshotDate 기준 KST 자정 경과일. 2 이상이면 stale 경고 라벨 표시. */
  ageDays?: number
  results: InventoryAnalysisResults
  shortageCount: number
  returnRateCount: number
  storageFeeCount: number
  winnerIssueCount: number
}): Promise<boolean> {
  const { results } = params
  const totalIssues =
    params.shortageCount + params.returnRateCount + params.storageFeeCount + params.winnerIssueCount

  if (totalIssues === 0) {
    console.log('[slack-inventory] 분석 이슈 없음 — 알림 건너뜀')
    return false
  }

  const inventoryUrl = process.env.WORKDECK_APP_URL
    ? `${process.env.WORKDECK_APP_URL}/d/coupang-ads/inventory`
    : 'https://app.workdeck.work/d/coupang-ads/inventory'

  const isStale = (params.ageDays ?? 0) >= 2
  const headerText = isStale
    ? `:clipboard: 쿠팡 재고 분석 완료 (⚠️ ${params.ageDays}일 전 데이터)`
    : ':clipboard: 쿠팡 재고 분석 완료'

  const blocks: Block[] = [
    header(headerText),
    divider(),
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*분석일*\n${formatDate(params.analysedAt)}` },
        { type: 'mrkdwn', text: `*기준 데이터 날짜*\n${formatDate(params.snapshotDate)}` },
      ],
    },
  ]

  const MAX_ITEMS = 5

  // 재고 부족
  if (results.stockShortage.length > 0) {
    blocks.push(divider())
    blocks.push(section(`:rotating_light: *재고 부족* (${params.shortageCount}건)`))
    blocks.push(
      section(
        formatItems(
          results.stockShortage.map((item) => ({
            label: `${item.productName}${item.optionName ? ` (${item.optionName})` : ''} — 추가입고 필요: ${item.requiredRestockQty.toLocaleString('ko-KR')}개`,
          })),
          MAX_ITEMS
        )
      )
    )
  }

  // 높은 반품율
  if (results.returnRate.length > 0) {
    blocks.push(divider())
    blocks.push(section(`:warning: *높은 반품율* (${params.returnRateCount}건)`))
    blocks.push(
      section(
        formatItems(
          results.returnRate.map((item) => ({
            label: `${item.productName}${item.optionName ? ` (${item.optionName})` : ''} — 반품율: ${item.returnRatePct}%`,
          })),
          MAX_ITEMS
        )
      )
    )
  }

  // 보관료 주의
  if (results.storageFee.length > 0) {
    blocks.push(divider())
    blocks.push(section(`:moneybag: *보관료 주의* (${params.storageFeeCount}건)`))
    blocks.push(
      section(
        formatItems(
          results.storageFee.map((item) => {
            const ratioText =
              item.storageFeeRatioPct != null ? `매출대비 ${item.storageFeeRatioPct}%` : '매출 없음'
            return {
              label: `${item.productName}${item.optionName ? ` (${item.optionName})` : ''} — 보관료: ${item.storageFee.toLocaleString('ko-KR')}원 (${ratioText})`,
            }
          }),
          MAX_ITEMS
        )
      )
    )
  }

  // 위너 미달성
  if (results.winnerStatus.length > 0) {
    blocks.push(divider())
    blocks.push(section(`:trophy: *위너 미달성* (${params.winnerIssueCount}건)`))
    blocks.push(
      section(
        formatItems(
          results.winnerStatus.map((item) => ({
            label: `${item.productName}${item.optionName ? ` (${item.optionName})` : ''} — 재고: ${item.availableStock.toLocaleString('ko-KR')}개`,
          })),
          MAX_ITEMS
        )
      )
    )
  }

  blocks.push(divider())
  blocks.push(context(`전체 결과는 <${inventoryUrl}|재고 관리 페이지>에서 확인하세요`))

  return sendDeckNotification({
    workspaceId: params.workspaceId,
    deckKey: DECK_KEY,
    blocks,
    text: `쿠팡 재고 분석 완료: ${totalIssues}건의 이슈 발견`,
  })
}

// ─── Stale 데이터 알림 ──────────────────────────────────────────────────────

/**
 * 재고 분석에 사용할 데이터가 오래되어(STALE_THRESHOLD_DAYS 이상) 분석을 스킵했음을 알린다.
 * 같은 snapshotDate에 대해 dedupe marker가 호출측에서 관리된다.
 */
export async function notifyInventoryStaleData(params: {
  workspaceId: string
  snapshotDate: Date
  ageDays: number
}): Promise<boolean> {
  const inventoryUrl = process.env.WORKDECK_APP_URL
    ? `${process.env.WORKDECK_APP_URL}/d/coupang-ads/inventory`
    : 'https://app.workdeck.work/d/coupang-ads/inventory'

  const blocks: Block[] = [
    header(':warning: 쿠팡 재고 분석 스킵 — 데이터 노후'),
    divider(),
    section(`*기준 데이터 날짜*\n${formatDate(params.snapshotDate)} (${params.ageDays}일 전)`),
    section('신선한 데이터가 없어 분석을 건너뜁니다.\n워커의 재고 수집 상태를 확인하세요.'),
    divider(),
    context(`<${inventoryUrl}|재고 관리 페이지>에서 마지막 상태를 확인하세요`),
  ]

  return sendDeckNotification({
    workspaceId: params.workspaceId,
    deckKey: DECK_KEY,
    blocks,
    text: `쿠팡 재고 분석 스킵 — 데이터가 ${params.ageDays}일 전입니다`,
  })
}

// ─── 워커 다운 알림 ────────────────────────────────────────────────────────

/**
 * 워커 heartbeat가 임계치를 넘기면 운영자에게 즉시 알린다.
 * dedupe는 호출측(cron)에서 관리.
 */
export async function notifyWorkerDown(params: {
  service: string
  lastPingAt: Date | null
  thresholdMinutes: number
}): Promise<boolean> {
  const lastPingText = params.lastPingAt
    ? `${params.lastPingAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (${Math.floor(
        (Date.now() - params.lastPingAt.getTime()) / 60_000
      )}분 전)`
    : '기록 없음'

  const blocks: Block[] = [
    header(':rotating_light: 워커 프로세스 다운 의심'),
    divider(),
    section(`*서비스*\n\`${params.service}\``),
    section(`*마지막 heartbeat*\n${lastPingText}`),
    section(
      `heartbeat가 ${params.thresholdMinutes}분 이상 끊겼습니다. 워커 호스트를 점검하세요.\n` +
        '```\npm2 status workdeck-worker\npm2 logs workdeck-worker --lines 200\npm2 restart workdeck-worker\n```'
    ),
  ]

  return sendSystemNotification({ blocks, text: `워커 다운 의심: ${params.service}` })
}
