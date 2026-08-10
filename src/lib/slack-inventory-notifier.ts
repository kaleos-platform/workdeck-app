/**
 * 재고 분석 결과 Slack 전송
 * worker/src/slack-notifier.ts와 동일한 패턴 사용
 */

import type { InventoryAnalysisResults } from '@/lib/inventory-analyzer'
import { sendDeckNotification, sendSystemNotification } from '@/lib/slack/send-notification'

// 재고 분석·수집 알림은 모두 쿠팡 광고 관리 Deck 소속.
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

  // 위너 미달성 — 갯수만 표시 (상세 리스트는 페이지에서 확인)
  if (params.winnerIssueCount > 0) {
    blocks.push(divider())
    blocks.push(
      section(
        `:trophy: *위너 미달성* — 재고 보유 중 위너 미달성 상품 *${params.winnerIssueCount}건*`
      )
    )
  }

  blocks.push(divider())
  blocks.push(context(`전체 결과는 <${inventoryUrl}|재고 관리 페이지>에서 확인하세요`))

  return sendDeckNotification({
    workspaceId: params.workspaceId,
    deckKey: DECK_KEY,
    eventKey: 'inventory_analysis_done',
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
    eventKey: 'inventory_stale',
    blocks,
    text: `쿠팡 재고 분석 스킵 — 데이터가 ${params.ageDays}일 전입니다`,
  })
}

// ─── 자동 재고 대조 알림 ───────────────────────────────────────────────────

export type AutoReconciliationIssue =
  | { kind: 'skip:incomplete-snapshot'; rowCount: number; baseline: number }
  | { kind: 'skip:large-delta'; changedRatio: number; systemOnlyRatio: number }
  | { kind: 'file-only'; count: number }
  | { kind: 'system-only-unmapped'; count: number }
  | { kind: 'failed'; count: number; firstReason: string }

/**
 * 자동 재고 대조(cron)에서 사람 개입이 필요한 상황만 알린다.
 * 정상 완료는 무음 — 매일 발송되면 알림 피로로 진짜 이상 신호를 놓친다.
 *
 * 운영자 대상이므로 Deck 토글에 걸리지 않는 시스템 알림으로 보낸다.
 */
export async function notifyAutoReconciliation(params: {
  spaceId: string
  snapshotDate: Date
  issues: AutoReconciliationIssue[]
}): Promise<boolean> {
  if (params.issues.length === 0) return false

  const reconUrl = process.env.WORKDECK_APP_URL
    ? `${process.env.WORKDECK_APP_URL}/d/seller-ops/inventory/reconciliation`
    : 'https://app.workdeck.work/d/seller-ops/inventory/reconciliation'

  const skipped = params.issues.some((i) => i.kind.startsWith('skip:'))

  const lines = params.issues.map((issue) => {
    switch (issue.kind) {
      case 'skip:incomplete-snapshot':
        return (
          `• *스냅샷 불완전 — 대조 건너뜀*\n` +
          `  ${issue.rowCount}행 (최근 최대 ${issue.baseline}행 대비 50% 미만). ` +
          `Wing 그리드 부분 export 의심 — 재고를 건드리지 않았습니다.`
        )
      case 'skip:large-delta':
        return (
          `• *변동폭 과다 — 대조 건너뜀*\n` +
          `  변동 ${Math.round(issue.changedRatio * 100)}% / 스냅샷 미존재 ${Math.round(
            issue.systemOnlyRatio * 100
          )}%. 대조는 PENDING 으로 남겼습니다 — 확인 후 수동 확정하세요.`
        )
      case 'file-only':
        return (
          `• *미매핑 외부 SKU ${issue.count}건*\n` +
          `  매핑이 없어 자동 반영하지 못했습니다. 매핑하면 다음 회차부터 자동 반영됩니다.\n` +
          `  _미매핑이 남아 있는 동안 '스냅샷에 없는 재고 0 처리'는 비활성입니다._`
        )
      case 'system-only-unmapped':
        return (
          `• *쿠팡 SKU 연결 필요 ${issue.count}건*\n` +
          `  쿠팡 스냅샷에 없는데 로켓그로스 위치에 재고가 남은 상품입니다. ` +
          `연결된 SKU 가 없어 소진인지 미연동인지 알 수 없어 재고를 건드리지 않았습니다.\n` +
          `  재고 조정 화면에서 *'파일 누락'* 필터의 '매핑 필요' 행에 쿠팡 SKU 를 연결해 주세요.`
        )
      case 'failed':
        return `• *조정 실패 ${issue.count}건*\n  첫 사유: ${issue.firstReason}`
    }
  })

  const blocks: Block[] = [
    header(
      skipped ? ':warning: 자동 재고 대조 건너뜀' : ':clipboard: 자동 재고 대조 — 확인 필요'
    ),
    divider(),
    section(`*스냅샷 기준일*\n${formatDate(params.snapshotDate)}`),
    section(lines.join('\n')),
    divider(),
    context(`<${reconUrl}|재고 조정 페이지>에서 확인하세요 · space \`${params.spaceId}\``),
  ]

  return sendSystemNotification({
    blocks,
    text: `자동 재고 대조 확인 필요 (${params.issues.map((i) => i.kind).join(', ')})`,
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
