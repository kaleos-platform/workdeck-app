/**
 * Worker → Slack 직접 전송 모듈
 * 수집/분석 완료 시 에밀리 봇 토큰으로 #agent-amely-work에 Block Kit 메시지 전송
 */

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? ''
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? ''
const SLACK_API_URL = 'https://slack.com/api/chat.postMessage'

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
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel: SLACK_CHANNEL_ID, blocks, text }),
    })

    const data = await res.json() as { ok: boolean; error?: string }
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
    header(':white_check_mark: 쿠팡 광고 데이터 수집 완료'),
    divider(),
    section(`*상태*\n완료`, `*수집 기간*\n${params.dateRange}`),
    section(
      `*등록*\n${params.insertedRows.toLocaleString()}건`,
      `*중복*\n${params.duplicateRows.toLocaleString()}건`,
    ),
    context(`전체 ${params.totalRows.toLocaleString()}건 처리`),
  ]

  await postMessage(blocks, `쿠팡 광고 데이터 수집 완료: 등록 ${params.insertedRows.toLocaleString()}건 (${params.dateRange})`)
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
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '광고 분석 보기', emoji: true },
          url: analysisUrl,
          style: 'primary',
        },
      ],
    },
  ]

  await postMessage(blocks, `쿠팡 광고 분석 완료: ${params.campaignCount}개 캠페인, ${params.suggestionCount}개 제안`)
}

/** 수집 실패 알림 */
export async function notifyCollectionFailed(error: string): Promise<void> {
  const blocks: Block[] = [
    header(':x: 쿠팡 광고 데이터 수집 실패'),
    divider(),
    section('*상태*\n실패'),
    section(error.slice(0, 200)),
  ]

  await postMessage(blocks, `쿠팡 광고 데이터 수집 실패: ${error.slice(0, 100)}`)
}
