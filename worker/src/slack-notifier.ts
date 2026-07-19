/**
 * Worker → Slack 전송 모듈 (멀티테넌트)
 * 수집/분석 완료 시 workspaceId로 Space의 notifications 채널을 찾아 Block Kit 메시지를 보낸다.
 * 전환기 이중화: 레거시 env(SLACK_BOT_TOKEN/SLACK_CHANNEL_ID, 구 에밀리 봇)가 설정돼 있으면
 * 그 경로로도 계속 발송한다 — 단 신규 경로 발송 채널과 레거시 채널이 같으면 중복 발송을 생략한다.
 */
import { getSlackNotificationTarget } from './api-client.js'
import { decrypt } from './encryption.js'

const LEGACY_SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? ''
const LEGACY_SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? ''
const SLACK_API_URL = 'https://slack.com/api/chat.postMessage'

// Deck 라벨 — Slack 메시지 헤더에 어떤 Deck 작업인지 표기 (정적).
// 광고·재고 수집 = 쿠팡 광고 관리자 Deck, 판매(VENDOR) = 브랜드 운영(seller-ops) Deck.
const DECK_COUPANG_ADS = '쿠팡 광고 관리자'
const DECK_SELLER_OPS = '브랜드 운영'

// Deck 토글 게이트용 DeckApp.id (라벨/URL의 seller-ops와 다름 — 판매 수집 Deck의 실 id는 seller-hub).
const DECK_KEY_COUPANG_ADS = 'coupang-ads'
const DECK_KEY_SELLER_HUB = 'seller-hub'

type Block = {
  type: string
  text?: unknown
  fields?: unknown[]
  elements?: unknown[]
  [key: string]: unknown
}

/** 단일 채널로 Slack Block Kit 메시지 전송 (raw) */
async function sendToChannel(
  token: string,
  channelId: string,
  blocks: Block[],
  text: string
): Promise<boolean> {
  try {
    const res = await fetch(SLACK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel: channelId, blocks, text }),
    })

    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!data.ok) {
      console.error(`[slack] 전송 실패 (channel=${channelId}): ${data.error}`)
      return false
    }

    console.log(`[slack] 메시지 전송 완료 (channel=${channelId})`)
    return true
  } catch (err) {
    console.error(`[slack] 전송 에러 (channel=${channelId}):`, err)
    return false
  }
}

/**
 * workspaceId 기반 신규 경로 발송 대상 + Deck 토글 상태를 조회해 복호화한다.
 * deckKey를 넘기면 notifyEnabled로 Deck 알림 토글을 함께 받는다.
 * 조회/복호화가 실패하면 null — 호출자는 게이트를 건너뛰고 레거시 경로로 폴백한다(fail-open).
 */
async function resolveNewPath(
  workspaceId: string,
  deckKey?: string,
  eventKey?: string
): Promise<{
  notifyEnabled: boolean
  channel: { token: string; channelId: string } | null
} | null> {
  try {
    const lookup = await getSlackNotificationTarget(workspaceId, deckKey, eventKey)
    if (!lookup.target) return { notifyEnabled: lookup.notifyEnabled, channel: null }
    const token = decrypt(lookup.target.botToken, lookup.target.botTokenIv)
    return {
      notifyEnabled: lookup.notifyEnabled,
      channel: { token, channelId: lookup.target.channelId },
    }
  } catch (err) {
    console.error('[slack] 알림 대상 조회/복호화 실패 — 레거시 경로만 사용:', err)
    return null
  }
}

/**
 * Slack에 Block Kit 메시지 전송 — 신규(멀티테넌트) 경로 + 레거시 env 경로 이중 발송.
 * workspaceId가 없으면(수집 파이프라인 초기 실패 등 컨텍스트 미확보) 레거시 경로만 시도한다.
 * deckKey가 주어지고 Deck 토글이 off(notifyEnabled===false)면 레거시 포함 전부 발송하지 않는다.
 * eventKey까지 주어지면 이벤트 단위 토글도 반영된다(해당 이벤트가 off면 발송하지 않는다).
 * 신규 경로가 성공하고 그 채널이 레거시 채널과 같으면 중복 방지를 위해 레거시 발송을 생략한다.
 */
async function postMessage(
  blocks: Block[],
  text: string,
  workspaceId?: string,
  deckKey?: string,
  eventKey?: string
): Promise<boolean> {
  let newPathSent = false
  let newPathChannelId: string | null = null

  if (workspaceId) {
    const resolved = await resolveNewPath(workspaceId, deckKey, eventKey)
    if (resolved) {
      // Deck 토글 off면 레거시 포함 전부 skip(토글이 authoritative).
      if (!resolved.notifyEnabled) {
        console.log('[slack] deck 알림 비활성 — 발송 생략')
        return false
      }
      if (resolved.channel) {
        newPathChannelId = resolved.channel.channelId
        newPathSent = await sendToChannel(
          resolved.channel.token,
          resolved.channel.channelId,
          blocks,
          text
        )
      }
    }
  }

  const legacyConfigured = Boolean(LEGACY_SLACK_BOT_TOKEN && LEGACY_SLACK_CHANNEL_ID)
  if (!legacyConfigured) {
    if (!newPathSent) {
      console.log('[slack] 레거시 봇 토큰/채널 미설정, 신규 경로 미등록 — 알림 건너뜀')
    }
    return newPathSent
  }

  // 신규 경로가 이미 같은 채널로 보냈으면 중복 발송 생략.
  if (newPathSent && newPathChannelId === LEGACY_SLACK_CHANNEL_ID) {
    return true
  }

  const legacySent = await sendToChannel(
    LEGACY_SLACK_BOT_TOKEN,
    LEGACY_SLACK_CHANNEL_ID,
    blocks,
    text
  )
  return newPathSent || legacySent
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
  workspaceId?: string
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
    `쿠팡 광고 데이터 수집 완료: 등록 ${params.insertedRows.toLocaleString()}건 (${params.dateRange})`,
    params.workspaceId,
    DECK_KEY_COUPANG_ADS,
    'collection_done'
  )
}

/** 분석 완료 알림 */
export async function notifyAnalysisDone(params: {
  summary: string
  suggestionCount: number
  campaignCount: number
  workspaceId?: string
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
    `쿠팡 광고 분석 완료: ${params.campaignCount}개 캠페인, ${params.suggestionCount}개 제안`,
    params.workspaceId,
    DECK_KEY_COUPANG_ADS
  )
}

/** 재고 수집 완료 알림 */
export async function notifyInventoryDone(params: {
  healthRows?: number
  errors: string[]
  workspaceId?: string
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

  await postMessage(
    blocks,
    `쿠팡 재고 데이터 수집 ${status}`,
    params.workspaceId,
    DECK_KEY_COUPANG_ADS,
    'inventory_collection_done'
  )
}

/** 수집 실패 알림 (workspaceId 확보 전 실패 경로에서도 호출되므로 옵션) */
export async function notifyCollectionFailed(error: string, workspaceId?: string): Promise<void> {
  const blocks: Block[] = [
    header(`:x: [${DECK_COUPANG_ADS}] 쿠팡 광고 데이터 수집 실패`),
    divider(),
    section('*상태*\n실패'),
    section(error.slice(0, 200)),
  ]

  await postMessage(
    blocks,
    `쿠팡 광고 데이터 수집 실패: ${error.slice(0, 100)}`,
    workspaceId,
    DECK_KEY_COUPANG_ADS,
    'collection_failed'
  )
}

/**
 * 쿠팡 로그인 실패 알림 — 사유별로 조치를 구체적으로 안내한다.
 * CREDENTIAL_INVALID: 비밀번호 변경·만료 → 운영자가 워크덱 설정에서 갱신해야 한다.
 * BOT_BLOCKED: Akamai 봇 차단 → 자동 로그인을 쿨다운하고 잠시 후 재시도된다.
 */
export async function notifyLoginFailed(params: {
  reason: 'CREDENTIAL_INVALID' | 'BOT_BLOCKED' | 'UNKNOWN'
  source: string // 'scheduled' | 'manual' | 'inventory' 등 — 어느 경로에서 났는지
  detail?: string
  workspaceId?: string // 자격증명 조회 전 실패라 대부분 미확보 → 레거시 경로만 발송됨
}): Promise<void> {
  const settingsUrl = process.env.WORKDECK_APP_URL
    ? `${process.env.WORKDECK_APP_URL}/d/coupang-ads/settings`
    : 'https://app.workdeck.work/d/coupang-ads/settings'

  let emoji = ':x:'
  let title = '쿠팡 로그인 실패'
  let guidance = ''
  switch (params.reason) {
    case 'CREDENTIAL_INVALID':
      emoji = ':lock:'
      title = '쿠팡 로그인 실패 — 아이디/비밀번호 불일치'
      guidance =
        `*비밀번호가 변경·만료되었을 가능성이 높습니다.*\n` +
        `워크덱 설정에서 쿠팡 계정 정보를 갱신해 주세요.\n<${settingsUrl}|:gear: 계정 정보 변경>`
      break
    case 'BOT_BLOCKED':
      emoji = ':no_entry:'
      title = '쿠팡 로그인 실패 — Akamai 봇 차단(Access Denied)'
      guidance =
        `자동 로그인이 쿠팡 봇 차단(Akamai)에 막혔습니다.\n` +
        `*자동 수집·백필*을 일시 중지(쿨다운)합니다. 수동 수집은 즉시 재시도 가능하며, ` +
        `수동 수집이 성공하면 쿨다운이 풀립니다. 반복되면 로그인 빈도(세션 재사용)를 점검하세요.`
      break
    default:
      title = '쿠팡 로그인 실패 — 사유 불명'
      guidance = '로그인 단계에서 실패했습니다. 워커 로그/스크린샷을 확인하세요.'
  }

  const blocks: Block[] = [
    header(`${emoji} [${DECK_COUPANG_ADS}] ${title}`),
    divider(),
    section(`*경로*\n${params.source}`, `*사유*\n${params.reason}`),
    section(guidance),
  ]
  if (params.detail) blocks.push(context(params.detail.slice(0, 200)))

  await postMessage(
    blocks,
    `쿠팡 로그인 실패(${params.reason}): ${title}`,
    params.workspaceId,
    DECK_KEY_COUPANG_ADS,
    'login_failed'
  )
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
  workspaceId?: string
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
    `[${DECK_SELLER_OPS}] 쿠팡 로켓그로스 판매 데이터 수집 완료: 매출 ${won(params.revenue)}, 주문 ${params.orderCount}건, 판매량 ${params.salesQty}개`,
    params.workspaceId,
    DECK_KEY_SELLER_HUB,
    'vendor_sales_done'
  )
}

/**
 * 로켓그로스 판매(VENDOR) 수집 실패 알림 — 한 수집 run 에서 실패한 일자를 모아 1건으로 발송.
 * togglable=false 이벤트라 UI 노출 없이 항상 발송된다(오류성 알림 규약).
 */
export async function notifyVendorSalesFailed(params: {
  failedDates: string[]
  error: string
  workspaceId?: string
}): Promise<void> {
  const dateList = params.failedDates.length > 0 ? params.failedDates.join(', ') : '(미상)'
  const blocks: Block[] = [
    header(`:warning: [${DECK_SELLER_OPS}] 쿠팡 판매 데이터 수집 실패`),
    divider(),
    section(`*상태*\n실패`, `*실패 일자*\n${dateList}`),
    section(`*오류*\n${params.error.slice(0, 200)}`),
  ]

  await postMessage(
    blocks,
    `[${DECK_SELLER_OPS}] 쿠팡 판매 데이터 수집 실패 (${dateList})`,
    params.workspaceId,
    DECK_KEY_SELLER_HUB,
    'vendor_sales_failed'
  )
}
