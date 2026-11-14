import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'
import { getWekeepInventoryRows, WekeepSourceError } from '@/lib/inv/reconciliation-sources'
import { aggregateMatchedByOption } from '@/lib/inv/reconciliation-resolve'
import { runReconciliationMatch } from '@/lib/inv/reconciliation-core'
import { confirmReconciliation } from '@/lib/inv/reconciliation-processor'
import { WekeepError } from '@/lib/inv/wekeep-client'
import { sendSpaceNotification } from '@/lib/slack/send-notification'

export const runtime = 'nodejs'

/** 자동 대조 파일명 접두 — 이전 자동 PENDING 을 날짜 무관하게 식별한다. */
const AUTO_FILE_PREFIX = '위킵 재고 (자동 '
/** 한 옵션의 |시스템-파일| 차이가 이 값을 넘으면 자동 확정 보류 */
const MAX_OPTION_DIFF = 50
/** 차이 옵션 수가 이 값을 넘으면 자동 확정 보류 */
const MAX_DIFF_OPTIONS = 10
const RECON_LINK = '/d/seller-ops/inventory/reconciliation'

/**
 * GET /api/cron/wekeep-weekly-reconcile — 매주 월 09:00 KST.
 * 위킵 연동 + 주간 자동 조정이 켜진 3PL 위치마다 라이브 재고를 대조하고,
 * 가드(큰 차이·차이 건수·미매핑 재고)를 통과하면 자동 확정, 아니면 PENDING 으로 두고 Slack 알림.
 * 위치 하나의 실패는 다른 위치에 영향을 주지 않는다. 비밀번호·원본 에러는 알림/로그에 싣지 않는다.
 */
async function run() {
  const locations = await prisma.invStorageLocation.findMany({
    where: { syncProvider: 'wekeep', autoReconcileWeekly: true, isActive: true },
    select: { id: true, spaceId: true, name: true },
  })

  const out = { processed: 0, confirmed: 0, held: 0, failed: 0 }
  const kstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

  for (const loc of locations) {
    out.processed++
    const notify = (text: string) => sendSpaceNotification({ spaceId: loc.spaceId, text })
    try {
      const parsed = await getWekeepInventoryRows(loc.spaceId, loc.id)
      if (parsed.rows.length === 0) {
        out.held++
        await notify(
          `[위킵 주간 재고 조정] ${loc.name}: 위킵 재고가 0건으로 조회돼 조정을 보류했습니다.`
        )
        continue
      }
      const core = await runReconciliationMatch({
        spaceId: loc.spaceId,
        parsed,
        locationId: loc.id,
        fileName: `${AUTO_FILE_PREFIX}${kstDate})`,
      })

      // 새 대조 생성에 성공한 뒤에만 이전 자동 PENDING 을 취소한다(로그인 실패 시 지난주 보류분 유지).
      await prisma.invReconciliation.updateMany({
        where: {
          spaceId: loc.spaceId,
          locationId: loc.id,
          status: 'PENDING',
          fileName: { startsWith: AUTO_FILE_PREFIX },
          id: { not: core.reconciliationId },
        },
        data: { status: 'CANCELLED' },
      })

      // 옵션 단위 합산 후 판단 — 같은 옵션을 여러 SKU 가 가리키면 합계가 일치할 수 있다.
      const entries = aggregateMatchedByOption(core.matchResult.entries, loc.id)
      const diffs = new Map<string, number>()
      for (const e of entries) {
        if (e.status === 'matched-diff') diffs.set(e.optionId, e.groupDelta ?? e.delta)
      }
      const reasons: string[] = []
      if ([...diffs.values()].some((d) => Math.abs(d) > MAX_OPTION_DIFF)) {
        reasons.push(`수량 차이 ${MAX_OPTION_DIFF} 초과 옵션 있음`)
      }
      if (diffs.size > MAX_DIFF_OPTIONS) reasons.push(`차이 옵션 ${MAX_DIFF_OPTIONS}건 초과`)
      const fileOnly = entries.filter((e) => e.status === 'file-only' && e.row.quantity > 0).length
      if (fileOnly > 0) reasons.push(`매핑 안 된 재고 SKU ${fileOnly}건`)

      if (reasons.length > 0) {
        out.held++
        await notify(
          `[위킵 주간 재고 조정] ${loc.name}: 차이 ${diffs.size}건 — 자동 확정을 보류했습니다 ` +
            `(${reasons.join(', ')}). 확인 후 직접 확정해 주세요: ${RECON_LINK}`
        )
        continue
      }

      const confirmed = await confirmReconciliation(loc.spaceId, core.reconciliationId, {
        selectedOptionIds: [...diffs.keys()],
        manualMappings: [],
        // 수동 확정 경로 — 차이 전량 반영 + CONFIRMED 잠금(system-only 0 처리는 하지 않는다).
        finalize: true,
      })
      const failedCount = confirmed.failed?.length ?? 0
      if (failedCount > 0 || confirmed.status !== 'CONFIRMED') {
        out.failed++
        await notify(
          `[위킵 주간 재고 조정] ${loc.name}: 일부 조정 실패 — ${confirmed.adjustedCount}건 반영, ` +
            `${failedCount}건 실패. 재고 조정 화면에서 확인해 주세요: ${RECON_LINK}`
        )
        continue
      }
      out.confirmed++
      await notify(
        `[위킵 주간 재고 조정] ${loc.name}: 조정 ${confirmed.adjustedCount}건 반영했습니다. ${RECON_LINK}`
      )
    } catch (err) {
      out.failed++
      // 원본 에러 메시지는 싣지 않는다(비밀값 유입 방지) — 종류만 로그.
      const known = err instanceof WekeepError || err instanceof WekeepSourceError
      console.error(
        `[cron/wekeep-weekly-reconcile] location ${loc.id} 실패:`,
        known ? (err as Error).name : 'unexpected'
      )
      await notify(
        known
          ? `[위킵 주간 재고 조정] ${loc.name}: 자동 조정에 실패했습니다. ` +
              `위치 관리에서 위킵 로그인 비밀값을 확인해 주세요. ${RECON_LINK}`
          : `[위킵 주간 재고 조정] ${loc.name}: 위킵 주간 자동 조정 중 오류가 발생했습니다. ` +
              `재고 조정 화면에서 수동 연동해 주세요. ${RECON_LINK}`
      )
    }
  }

  return out
}

export const GET = withCronRun(
  '/api/cron/wekeep-weekly-reconcile',
  run,
  'cron-secret',
  (d) => d.failed === 0
)
