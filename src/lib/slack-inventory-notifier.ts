/**
 * 재고 분석 결과 Slack 전송
 * worker/src/slack-notifier.ts와 동일한 패턴 사용
 */

import type { InventoryAnalysisResults } from '@/lib/inventory-analyzer'

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

async function postMessage(blocks: Block[], text: string): Promise<boolean> {
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('[slack-inventory] 봇 토큰 또는 채널 ID 미설정 — 알림 건너뜀')
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
      console.error(`[slack-inventory] 전송 실패: ${data.error}`)
      return false
    }

    console.log('[slack-inventory] 메시지 전송 완료')
    return true
  } catch (err) {
    console.error('[slack-inventory] 전송 에러:', err)
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

function section(text: string): Block {
  return { type: 'section', text: { type: 'mrkdwn', text } }
}

function context(text: string): Block {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] }
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
}

function formatItems(
  items: Array<{ label: string }>,
  maxItems: number,
): string {
  const shown = items.slice(0, maxItems)
  const lines = shown.map((item) => `• ${item.label}`)
  if (items.length > maxItems) {
    lines.push(`  _+${items.length - maxItems}건 더_`)
  }
  return lines.join('\n')
}

// ─── 알림 전송 ──────────────────────────────────────────────────────────────

export async function notifyInventoryAnalysis(params: {
  analysedAt: Date
  snapshotDate: Date
  results: InventoryAnalysisResults
  shortageCount: number
  returnRateCount: number
  storageFeeCount: number
  winnerIssueCount: number
}): Promise<void> {
  const { results } = params
  const totalIssues =
    params.shortageCount + params.returnRateCount + params.storageFeeCount + params.winnerIssueCount

  if (totalIssues === 0) {
    console.log('[slack-inventory] 분석 이슈 없음 — 알림 건너뜀')
    return
  }

  const inventoryUrl = process.env.WORKDECK_APP_URL
    ? `${process.env.WORKDECK_APP_URL}/d/coupang-ads/inventory`
    : 'https://app.workdeck.work/d/coupang-ads/inventory'

  const blocks: Block[] = [
    header(':clipboard: 쿠팡 재고 분석 완료'),
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
          MAX_ITEMS,
        ),
      ),
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
          MAX_ITEMS,
        ),
      ),
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
              item.storageFeeRatioPct != null
                ? `매출대비 ${item.storageFeeRatioPct}%`
                : '매출 없음'
            return {
              label: `${item.productName}${item.optionName ? ` (${item.optionName})` : ''} — 보관료: ${item.storageFee.toLocaleString('ko-KR')}원 (${ratioText})`,
            }
          }),
          MAX_ITEMS,
        ),
      ),
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
          MAX_ITEMS,
        ),
      ),
    )
  }

  blocks.push(divider())
  blocks.push(context(`전체 결과는 <${inventoryUrl}|재고 관리 페이지>에서 확인하세요`))

  await postMessage(blocks, `쿠팡 재고 분석 완료: ${totalIssues}건의 이슈 발견`)
}
