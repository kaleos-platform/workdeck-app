/** 대사 실행 — DB 로드 → 게이트 → (diagnose 리포트 | 판정) → PipelineOperation(RECONCILE) + Slack. */
import { prisma } from '@/lib/prisma'
import { escapeMrkdwn } from '@/lib/slack/mrkdwn'
import { sendSpaceNotification } from '@/lib/slack/send-notification'
import { normalizeAlias } from '@/lib/sh/product-matching'
import {
  counts as verdictCounts,
  diagnose,
  evaluateGate,
  judge,
  judgeWindowFor,
  type DiagnoseReport,
  type ExcelOrder,
  type JudgeWindow,
  type ObsLine,
  type ScanLine,
  type Verdict,
} from './reconcile'
import { cleanupStaleOperations, purgeOldScanLines } from './operations'
import { parseMatchRule, type ObserveCursor } from './types'

const DAY = 86_400_000

export type ChannelOutcome =
  | { channel: string; mode: 'diagnose'; report: DiagnoseReport }
  | { channel: string; mode: 'judge'; verdict: Verdict }
  | { channel: string; mode: 'unjudgeable'; reasons: string[] }

type SettingRow = Awaited<ReturnType<typeof loadSettings>>[number]

const loadSettings = (spaceId: string) =>
  prisma.channelFulfillmentSetting.findMany({
    where: { spaceId, observeEnabled: true },
    include: { channel: { select: { id: true, name: true } } },
  })

async function loadChannelInputs(s: SettingRow, now: Date) {
  const channelId = s.channelId
  // 대사 한 번의 판정 창 W 는 가장 최근 전수 조회의 시작 시각으로 정해진다(없으면 지금 기준 — 어차피 게이트에서 판정 불가).
  const lastScan = await prisma.pipelineOperation.findFirst({
    where: { channelId, kind: 'FULL_SCAN' },
    orderBy: { startedAt: 'desc' },
  })
  const window: JudgeWindow = judgeWindowFor(lastScan?.startedAt ?? now)
  const [lines, aliases, delOrders, recentObserve] = await Promise.all([
    prisma.channelOrderLine.findMany({
      where: {
        channelId,
        paidAt: { gte: new Date(now.getTime() - 30 * DAY) },
        // 판정은 paidAt∈W 또는 미종결(결제일 무관)만 본다 — 정확한 필터는 judge() 가 한다.
        OR: [{ paidAt: { gte: window.from } }, { dispatchedAt: null }],
      },
    }),
    prisma.channelProductAlias.findMany({
      where: { channelId },
      select: { aliasName: true, optionId: true, listingId: true },
    }),
    prisma.delOrder.findMany({
      where: {
        spaceId: s.spaceId,
        orderNumber: { not: null },
        // 주문일이 W 의 KST 날짜 범위 — 정확한 필터는 judge() 가 한다(여유 1일).
        orderDate: { gte: new Date(window.from.getTime() - DAY) },
        batch: { source: 'MANUAL' },
        OR: [{ channelId }, { channelId: null }],
      },
      select: {
        orderNumber: true,
        orderDate: true,
        channelId: true,
        batch: { select: { status: true } },
        items: { select: { quantity: true, optionId: true, listingId: true } },
      },
    }),
    prisma.pipelineOperation.findMany({
      where: { channelId, kind: 'OBSERVE', startedAt: { gte: new Date(now.getTime() - DAY) } },
      select: { status: true },
    }),
  ])
  const aliasMap = new Map(
    aliases.map((a) => [a.aliasName, a.listingId ? `L:${a.listingId}` : `O:${a.optionId}`])
  )
  const obs: ObsLine[] = lines.map((l) => ({
    key: l.externalLineKey,
    orderId: l.externalOrderId,
    quantity: l.quantity,
    status: l.channelStatus,
    claimStatus: l.claimStatus,
    paidAt: l.paidAt,
    shippingDueAt: l.shippingDueAt,
    trackingNumber: l.trackingNumber,
    dispatchedAt: l.dispatchedAt,
    deliveryKind: l.deliveryKind,
    productName: l.productName,
    target:
      aliasMap.get(normalizeAlias(`${l.productName} ${l.optionText ?? ''}`)) ??
      aliasMap.get(normalizeAlias(l.productName)) ??
      null,
    lastSeenAt: l.lastSeenAt,
  }))
  const excel: ExcelOrder[] = delOrders.map((o) => ({
    orderNumber: o.orderNumber as string,
    orderDate: o.orderDate,
    quantity: o.items.reduce((n, i) => n + i.quantity, 0),
    completed: o.batch.status === 'COMPLETED',
    targets: o.items.map((i) =>
      i.listingId ? `L:${i.listingId}` : i.optionId ? `O:${i.optionId}` : null
    ),
    channelLinked: o.channelId === channelId,
  }))
  const scanLines: ScanLine[] =
    lastScan?.status === 'SUCCEEDED'
      ? (
          await prisma.channelOrderScanLine.findMany({
            where: { operationId: lastScan.id, paidAt: { gte: window.from, lt: window.to } },
          })
        ).map((r) => ({
          key: r.externalLineKey,
          orderId: r.externalOrderId,
          quantity: r.quantity,
          status: r.channelStatus,
          paidAt: r.paidAt,
        }))
      : []
  return { obs, excel, scanLines, lastScan, recentObserve, window }
}

export async function reconcileChannel(s: SettingRow, now: Date): Promise<ChannelOutcome> {
  const channel = `${s.channel.name}(${s.adapter})`
  const inp = await loadChannelInputs(s, now)
  if (s.reconcileMode !== 'judge') {
    return { channel, mode: 'diagnose', report: diagnose({ obs: inp.obs, excel: inp.excel }) }
  }
  const reasons = evaluateGate({
    now,
    recentObserve: inp.recentObserve,
    cursor: (s.observeCursor as ObserveCursor | null) ?? null,
    lastScan: inp.lastScan && {
      status: inp.lastScan.status,
      finishedAt: inp.lastScan.finishedAt,
      counts: inp.lastScan.counts as never,
    },
  })
  if (reasons.length) return { channel, mode: 'unjudgeable', reasons }
  return {
    channel,
    mode: 'judge',
    verdict: judge({
      now,
      window: inp.window,
      obs: inp.obs,
      scan: inp.scanLines,
      excel: inp.excel,
      rule: parseMatchRule(s.matchKeyRule),
    }),
  }
}

const pct = (m: number, t: number) => (t ? `${Math.round((m / t) * 100)}%` : '-')

export function formatReport(outcomes: ChannelOutcome[]): string {
  const out: string[] = ['*주문 관측 대사 리포트*']
  for (const o of outcomes) {
    const name = escapeMrkdwn(o.channel)
    if (o.mode === 'diagnose') {
      const r = o.report
      out.push(
        `\n*${name}* — 키 진단 모드(판정 안 함)`,
        `관측 ${r.observed}행 / 엑셀 ${r.excelTotal}건(이 채널 연결 ${r.excelLinked}, 미연결 ${r.excelUnlinked})`,
        `관측 주문번호 형식: ${r.obsPatterns.map((p) => `${p.pattern}×${p.count}`).join(', ') || '-'}`,
        `엑셀 주문번호 형식: ${r.excelPatterns.map((p) => `${p.pattern}×${p.count}`).join(', ') || '-'}`,
        `후보 키 일치율: ${r.matchRates.map((m) => `${m.field} ${pct(m.matched, m.total)}(${m.matched}/${m.total})`).join(', ')}`
      )
    } else if (o.mode === 'unjudgeable') {
      out.push(`\n*${name}* — 판정 불가(성공 아님): ${o.reasons.join(', ')}`)
    } else {
      const c = verdictCounts(o.verdict)
      out.push(
        `\n*${name}* — A ${c.A} · B ${c.B} · C ${c.C} · D ${c.D} · E ${c.E} · F(상태 시차, 정보) ${c.F}`
      )
      for (const k of ['A', 'C', 'D', 'E', 'B'] as const) {
        for (const f of o.verdict[k].slice(0, 10)) {
          out.push(
            `  ${k} ${escapeMrkdwn(f.ref.slice(0, 40))} — ${escapeMrkdwn(f.note.slice(0, 80))}`
          )
        }
      }
    }
  }
  return out.join('\n')
}

/** 모든 Space 의 관측 채널을 대사한다. */
export async function runReconcile(now = new Date()) {
  await cleanupStaleOperations(now)
  await purgeOldScanLines(now)
  const spaces = await prisma.channelFulfillmentSetting.findMany({
    where: { observeEnabled: true },
    distinct: ['spaceId'],
    select: { spaceId: true },
  })
  const summary: Array<{ spaceId: string; channels: number; status: string }> = []
  for (const { spaceId } of spaces) {
    const op = await prisma.pipelineOperation.create({
      data: { spaceId, kind: 'RECONCILE', startedAt: now },
    })
    try {
      const outcomes: ChannelOutcome[] = []
      for (const s of await loadSettings(spaceId)) outcomes.push(await reconcileChannel(s, now))
      const status = outcomes.some((o) => o.mode === 'unjudgeable') ? 'PARTIAL' : 'SUCCEEDED'
      await prisma.pipelineOperation.update({
        where: { id: op.id },
        data: {
          status,
          finishedAt: new Date(),
          counts: Object.fromEntries(
            outcomes.map((o) => [
              o.channel,
              o.mode === 'judge'
                ? verdictCounts(o.verdict)
                : o.mode === 'unjudgeable'
                  ? { unjudgeable: o.reasons }
                  : { diagnose: { observed: o.report.observed, excel: o.report.excelTotal } },
            ])
          ),
        },
      })
      await sendSpaceNotification({ spaceId, text: formatReport(outcomes) })
      summary.push({ spaceId, channels: outcomes.length, status })
    } catch (err) {
      console.error(
        '[channel-orders-reconcile] 실패',
        spaceId,
        err instanceof Error ? err.message : err
      )
      await prisma.pipelineOperation.update({
        where: { id: op.id },
        data: { status: 'FAILED', error: 'unknown', finishedAt: new Date() },
      })
      summary.push({ spaceId, channels: 0, status: 'FAILED' })
    }
  }
  return { spaces: summary }
}
