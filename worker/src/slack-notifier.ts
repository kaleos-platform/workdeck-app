/**
 * Worker → Slack 직접 전송 모듈
 * 수집/분석 완료 시 에밀리 봇 토큰으로 #agent-amely-work에 Block Kit 메시지 전송
 */

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? ''
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? ''
const SLACK_API_URL = 'https://slack.com/api/chat.postMessage'

// Deck 라벨 — Slack 메시지 헤더에 어떤 Deck 작업인지 표기 (정적).
// 광고·재고 수집 = 쿠팡 광고 관리자 Deck, 판매(VENDOR) = 브랜드 운영(seller-ops) Deck.
const DECK_COUPANG_ADS = '쿠팡 광고 관리자'
const DECK_SELLER_OPS = '브랜드 운영'

type Block = {
  type: string
  text?: unknown
  fields?: unknown[]
  elements?: unknown[]
  [key: string]: unknown
}

/** Slack에 Block Kit 메시지 전송 */
async function postMessage(blocks: Block[], text: string): Promise<boolean> {
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('[slack] 봇 토큰 또는 채널 ID 미설정 — 알림 건너뜀')
    return false
  }

  try {
    const res = await fetch(SLACK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel: SLACK_CHANNEL_ID, blocks, text }),
    })

    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!data.ok) {
      console.error(`[slack] 전송 실패: ${data.error}`)
      return false
    }

    console.log('[slack] 메시지 전송 완료')
    return true
  } catch (err) {
    console.error('[slack] 전송 에러:', err)
    return false
  }
}

// ─── Block Kit 헬퍼 ─────────────────────────────────────────────────────────

function header(text: string): Block {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } }
}

function divider(): Block {
  return { type: 'divider' }
}

function section(text: string, accessoryText?: string): Block {
  if (accessoryText) {
    return {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text },
        { type: 'mrkdwn', text: accessoryText },
      ],
    }
  }
  return { type: 'section', text: { type: 'mrkdwn', text } }
}

function context(text: string): Block {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] }
}

function won(v?: number): string {
  if (v == null) return '-'
  return `${v.toLocaleString('ko-KR')}원`
}

function pct(v?: number): string {
  if (v == null) return '-'
  return `${v.toFixed(1)}%`
}

// ─── 알림 전송 함수 ──────────────────────────────────────────────────────────

/** 수집 완료 알림 */
export async function notifyCollectionDone(params: {
  dateRange: string
  totalRows: number
  insertedRows: number
  duplicateRows: number
}): Promise<void> {
  const blocks: Block[] = [
    header(`:white_check_mark: [${DECK_COUPANG_ADS}] 쿠팡 광고 데이터 수집 완료`),
    divider(),
    section(`*상태*\n완료`, `*수집 기간*\n${params.dateRange}`),
    section(
      `*등록*\n${params.insertedRows.toLocaleString()}건`,
      `*중복*\n${params.duplicateRows.toLocaleString()}건`
    ),
    context(`전체 ${params.totalRows.toLocaleString()}건 처리`),
  ]

  await postMessage(
    blocks,
    `쿠팡 광고 데이터 수집 완료: 등록 ${params.insertedRows.toLocaleString()}건 (${params.dateRange})`
  )
}

/** 분석 완료 알림 */
export async function notifyAnalysisDone(params: {
  summary: string
  suggestionCount: number
  campaignCount: number
}): Promise<void> {
  const analysisUrl = process.env.WORKDECK_APP_URL
    ? `${process.env.WORKDECK_APP_URL}/d/coupang-ads/analysis`
    : 'https://app.workdeck.work/d/coupang-ads/analysis'

  const blocks: Block[] = [
    header(':white_check_mark: 쿠팡 광고 분석 완료'),
    divider(),
    section(`*상태*\n완료`, `*캠페인*\n${params.campaignCount}개`),
    section(`*제안*\n${params.suggestionCount}개`),
    section(params.summary),
    section(`<${analysisUrl}|:mag: 광고 분석 보기>`),
  ]

  await postMessage(
    blocks,
    `쿠팡 광고 분석 완료: ${params.campaignCount}개 캠페인, ${params.suggestionCount}개 제안`
  )
}

/** 재고 수집 완료 알림 */
export async function notifyInventoryDone(params: {
  healthRows?: number
  errors: string[]
}): Promise<void> {
  const hasData = (params.healthRows ?? 0) > 0
  const hasErrors = params.errors.length > 0

  if (!hasData && !hasErrors) return // 결과가 없으면 알림 생략

  const emoji = hasErrors ? ':warning:' : ':white_check_mark:'
  const status = hasErrors ? (hasData ? '일부 완료' : '실패') : '완료'

  const inventoryUrl = process.env.WORKDECK_APP_URL
    ? `${process.env.WORKDECK_APP_URL}/d/coupang-ads/inventory`
    : 'https://app.workdeck.work/d/coupang-ads/inventory'

  const blocks: Block[] = [
    header(`${emoji} [${DECK_COUPANG_ADS}] 쿠팡 재고 데이터 수집 ${status}`),
    divider(),
    section(
      `*재고현황*\n${params.healthRows != null ? `${params.healthRows.toLocaleString()}건` : '미수집'}`
    ),
  ]

  if (hasErrors) {
    blocks.push(section(`*오류*\n${params.errors.join('\n').slice(0, 200)}`))
  }

  blocks.push(section(`<${inventoryUrl}|:package: 재고 현황 보기>`))

  await postMessage(blocks, `쿠팡 재고 데이터 수집 ${status}`)
}

/** 수집 실패 알림 */
export async function notifyCollectionFailed(error: string): Promise<void> {
  const blocks: Block[] = [
    header(`:x: [${DECK_COUPANG_ADS}] 쿠팡 광고 데이터 수집 실패`),
    divider(),
    section('*상태*\n실패'),
    section(error.slice(0, 200)),
  ]

  await postMessage(blocks, `쿠팡 광고 데이터 수집 실패: ${error.slice(0, 100)}`)
}

/** 로켓그로스 판매(VENDOR) 수집 완료 알림 — cron(daily) / 백필 공용 */
export async function notifyVendorSalesDone(params: {
  mode: 'daily' | 'backfill'
  dateRange: string
  collectedDays?: number // 백필: 수집 성공 일수
  insertedRows?: number // 적재된 VENDOR 행 수
  duplicateRows?: number // 중복으로 건너뛴 행 수
  outboundCount: number // OUTBOUND(재고차감) 변환 건수
  revenue: number // 매출 합
  orderCount: number // 주문 합
  salesQty: number // 판매량 합
}): Promise<void> {
  const salesUrl = process.env.WORKDECK_APP_URL
    ? `${process.env.WORKDECK_APP_URL}/d/seller-ops/settings/integration`
    : 'https://app.workdeck.work/d/seller-ops/settings/integration'

  const title =
    params.mode === 'backfill'
      ? `:white_check_mark: [${DECK_SELLER_OPS}] 쿠팡 로켓그로스 판매 데이터 백필 완료`
      : `:white_check_mark: [${DECK_SELLER_OPS}] 쿠팡 로켓그로스 판매 데이터 수집 완료`

  const blocks: Block[] = [
    header(title),
    divider(),
    section(`*매출*\n${won(params.revenue)}`, `*주문*\n${params.orderCount.toLocaleString()}건`),
    section(
      `*판매량*\n${params.salesQty.toLocaleString()}개`,
      `*재고차감(OUTBOUND)*\n${params.outboundCount.toLocaleString()}건`
    ),
  ]

  // 수집 기간·적재·중복
  const collectedLabel =
    params.mode === 'backfill' && params.collectedDays != null
      ? `${params.collectedDays}일 (${params.dateRange})`
      : params.dateRange
  blocks.push(section(`*수집 기간*\n${collectedLabel}`))

  const ctx: string[] = []
  if (params.insertedRows != null) ctx.push(`적재 ${params.insertedRows.toLocaleString()}건`)
  if (params.duplicateRows != null && params.duplicateRows > 0)
    ctx.push(`중복 ${params.duplicateRows.toLocaleString()}건`)
  if (ctx.length > 0) blocks.push(context(ctx.join(' · ')))

  blocks.push(section(`<${salesUrl}|:bar_chart: 판매 수집 이력 보기>`))

  await postMessage(
    blocks,
    `[${DECK_SELLER_OPS}] 쿠팡 로켓그로스 판매 데이터 수집 완료: 매출 ${won(params.revenue)}, 주문 ${params.orderCount}건, 판매량 ${params.salesQty}개`
  )
}
