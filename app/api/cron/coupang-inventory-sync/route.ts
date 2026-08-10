import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'
import { COUPANG_ADS_DECK_ID } from '@/lib/deck-routes'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import { getCoupangInventoryRows } from '@/lib/inv/reconciliation-sources'
import { runReconciliationMatch } from '@/lib/inv/reconciliation-core'
import { confirmReconciliation } from '@/lib/inv/reconciliation-processor'
import {
  notifyAutoReconciliation,
  type AutoReconciliationIssue,
} from '@/lib/slack-inventory-notifier'

export const runtime = 'nodejs'

const WORKER_SERVICE = 'coupang-inventory-sync'

// 대량 변동 가드 — 하나라도 넘으면 그 Space 의 대조를 통째로 스킵한다.
// 개별 20% 경고(movement-processor)와 달리 이건 차단이다.
const MAX_CHANGED_RATIO = 0.3 // 변동(matched-diff) 옵션 비율
const MAX_SYSTEM_ONLY_RATIO = 0.2 // 스냅샷에 없는 재고 보유 옵션 비율
// 비율만 보면 SKU 가 적은 셀러는 정상 변동에도 매일 걸려 자동 대조가 영영 안 돈다
// (SKU 3개 중 1개 변동 = 33%). 절대 건수도 함께 넘을 때만 차단한다.
// 소규모 카탈로그의 부분 export 는 완전성 가드(행수 baseline)가 이미 잡는다.
const MIN_ABS_FOR_RATIO_GUARD = 10

/**
 * GET /api/cron/coupang-inventory-sync — 워커 체이닝 전용(x-worker-api-key).
 *
 * 쿠팡 로켓그로스 최신 재고현황(inventory_health) 스냅샷을 자동 대조·반영해
 * InvStockLevel 을 실측 기준으로 보정한다. 수동 '데이터 연동' 버튼 없이 매일 동작.
 *
 * 반영 정책 (스냅샷 = 실측 원본이라는 전제):
 *  - matched-diff  → 자동 반영(ADJUSTMENT, 절대량 set)
 *  - matched-equal → 무시(movement 없음)
 *  - file-only     → 매핑이 없어 자동 반영 불가. PARTIAL 유지 + Slack 알림
 *  - system-only   → **조건부** 0 반영. file-only 0건 AND 스냅샷 완전성 통과일 때만.
 *                    미매핑이 남아 있으면 "스냅샷에 없음"이 매핑 누락일 수 있다.
 *
 * 안전장치: 스냅샷 완전성 가드 / 대량 변동 가드 — 걸리면 재고를 건드리지 않고 스킵 + 알림.
 * 멱등: 같은 (spaceId, locationId, snapshotDate) 가 이미 처리됐으면 skip.
 *
 * 호출 순서 주의: 반드시 coupang-sales-sync **뒤에** 호출해야 한다. 스냅샷은 수집 시점의
 * Wing 실재고라 어제 판매가 이미 반영돼 있다. 절대량 set 인 대조를 sales-sync 앞에 적용하면
 * 그 뒤 OUTBOUND 가 한 번 더 빠져 이중 차감된다.
 *
 * vercel.json crons 에 등록하지 않는다 — 워커가 수집에 성공했을 때만 도는 게 맞다.
 * (워커 다운 시 데이터는 멈추되 잘못된 데이터는 들어가지 않는다. sales-sync 와 동일 방침.)
 *
 * withCronRun 으로 감싸 CronRun 에 실행 이력을 남긴다. 등록 cron 이 아니라서
 * "워커가 안 불렀다"와 "불렀는데 실패했다"를 구별할 다른 수단이 없다.
 */
async function runInventorySync() {
  const locations = await prisma.invStorageLocation.findMany({
    where: {
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
      isActive: true,
      locationMappings: { some: {} },
    },
    select: { spaceId: true },
    distinct: ['spaceId'],
  })

  const summary: Array<{
    spaceId: string
    status: string
    adjusted?: number
    fileOnly?: number
    zeroed?: number
    /** 매핑이 없어 0 처리하지 못한 system-only 건수 — 사용자 매핑 필요 */
    mappingNeeded?: number
  }> = []

  for (const { spaceId } of locations) {
    try {
      const deck = await prisma.deckInstance.findUnique({
        where: { spaceId_deckAppId: { spaceId, deckAppId: COUPANG_ADS_DECK_ID } },
        select: { isActive: true },
      })
      if (!deck?.isActive) {
        summary.push({ spaceId, status: 'skip:deck-inactive' })
        continue
      }

      const resolved = await resolveCoupangWorkspaceForSpace(spaceId)
      if (!resolved) {
        summary.push({ spaceId, status: 'skip:no-workspace-link' })
        continue
      }

      // 최신 inventory_health 스냅샷 조회
      const parsed = await getCoupangInventoryRows(resolved.workspaceId)
      if (!parsed.snapshotDate || parsed.rows.length === 0) {
        summary.push({ spaceId, status: 'skip:no-snapshot' })
        continue
      }

      // 가드 1: 스냅샷 완전성 — 부분 export 를 반영하면 재고가 대량으로 죽는다.
      //         대조 레코드 자체를 만들지 않는다(사람이 봐도 쓸모없는 스냅샷).
      if (!parsed.completeness.ok) {
        console.warn(
          `[cron/${WORKER_SERVICE}] space ${spaceId}: 스냅샷 불완전 ` +
            `(${parsed.completeness.rowCount}행 / baseline ${parsed.completeness.baseline}) — 스킵`
        )
        await notifyAutoReconciliation({
          spaceId,
          snapshotDate: parsed.snapshotDate,
          issues: [
            {
              kind: 'skip:incomplete-snapshot',
              rowCount: parsed.completeness.rowCount,
              baseline: parsed.completeness.baseline,
            },
          ],
        }).catch((err) => console.warn(`[cron/${WORKER_SERVICE}] 알림 실패`, err))
        summary.push({ spaceId, status: 'skip:incomplete-snapshot' })
        continue
      }

      // 멱등 skip-marker — 같은 스냅샷이 이미 처리됐으면 skip.
      // InvReconciliation 에 unique 제약이 없고, 재적용 가드는 같은 reconciliationId
      // 안에서만 동작한다. 새 레코드로 다시 confirm 하면 referenceId 가 달라져 그 사이의
      // INBOUND/OUTBOUND 가 스냅샷 값으로 조용히 덮어써진다.
      const snapshotStr = parsed.snapshotDate.toISOString().slice(0, 10)
      const autoFileName = `쿠팡 로켓그로스 재고 (자동 ${snapshotStr})`

      const alreadyHandled = await prisma.invReconciliation.findFirst({
        where: {
          spaceId,
          locationId: resolved.locationId,
          snapshotDate: parsed.snapshotDate,
          OR: [
            { status: { in: ['APPLIED', 'PARTIAL', 'CONFIRMED'] } },
            // 가드에 걸려 PENDING 으로 남긴 자동 대조 — 매일 재생성되면 PENDING 이 쌓인다.
            // 사람이 확인할 1건만 남기고 이후 회차는 skip.
            { status: 'PENDING', fileName: autoFileName },
          ],
        },
        select: { id: true, status: true },
      })
      if (alreadyHandled) {
        summary.push({
          spaceId,
          status:
            alreadyHandled.status === 'PENDING' ? 'skip:pending-review' : 'skip:already-applied',
        })
        continue
      }

      const core = await runReconciliationMatch({
        spaceId,
        parsed,
        locationId: resolved.locationId,
        fileName: autoFileName,
      })

      const entries = core.matchResult.entries
      const matchedDiffOptionIds = entries
        .filter((e) => e.status === 'matched-diff')
        .map((e) => e.optionId)
      const fileOnlyCount = entries.filter((e) => e.status === 'file-only').length
      const systemOnlyCount = entries.filter((e) => e.status === 'system-only').length

      // 가드 2: 대량 변동 — 분모는 시스템 재고와 대응되는 항목 수(matched-* + system-only).
      //         file-only 는 아직 시스템에 없는 SKU 라 변동률 분모로 부적절하다.
      const systemSideCount =
        entries.filter((e) => e.status === 'matched-diff' || e.status === 'matched-equal').length +
        systemOnlyCount
      const changedRatio = systemSideCount > 0 ? matchedDiffOptionIds.length / systemSideCount : 0
      const systemOnlyRatio = systemSideCount > 0 ? systemOnlyCount / systemSideCount : 0

      const changedTooMuch =
        matchedDiffOptionIds.length >= MIN_ABS_FOR_RATIO_GUARD && changedRatio > MAX_CHANGED_RATIO
      const systemOnlyTooMuch =
        systemOnlyCount >= MIN_ABS_FOR_RATIO_GUARD && systemOnlyRatio > MAX_SYSTEM_ONLY_RATIO

      if (changedTooMuch || systemOnlyTooMuch) {
        // 대조 레코드는 PENDING 으로 남긴다 — 사람이 미리보기로 확인 후 수동 확정할 수 있게.
        console.warn(
          `[cron/${WORKER_SERVICE}] space ${spaceId}: 변동폭 과다 ` +
            `(변동 ${(changedRatio * 100).toFixed(1)}%, 미존재 ${(systemOnlyRatio * 100).toFixed(1)}%) — 스킵`
        )
        await notifyAutoReconciliation({
          spaceId,
          snapshotDate: parsed.snapshotDate,
          issues: [{ kind: 'skip:large-delta', changedRatio, systemOnlyRatio }],
        }).catch((err) => console.warn(`[cron/${WORKER_SERVICE}] 알림 실패`, err))
        summary.push({
          spaceId,
          status: 'skip:large-delta',
          fileOnly: fileOnlyCount,
        })
        continue
      }

      // system-only 0 반영은 미매핑이 하나도 없을 때만 — 매핑 누락과 실제 소진을 구별할 수 없다.
      const includeSystemOnly = fileOnlyCount === 0
      const issues: AutoReconciliationIssue[] = []

      let adjusted = 0
      let zeroed = 0
      let mappingNeeded = 0
      if (matchedDiffOptionIds.length > 0 || (includeSystemOnly && systemOnlyCount > 0)) {
        const confirmed = await confirmReconciliation(spaceId, core.reconciliationId, {
          selectedOptionIds: matchedDiffOptionIds,
          manualMappings: [],
          includeSystemOnly,
        })
        adjusted = confirmed.adjustedCount
        // 매핑 없는 system-only 는 0 처리되지 않는다 — 사용자 매핑이 필요한 잔여
        mappingNeeded = confirmed.unmappedSystemOnly ?? 0
        zeroed = includeSystemOnly ? systemOnlyCount - mappingNeeded : 0
        if (mappingNeeded > 0) {
          issues.push({ kind: 'system-only-unmapped', count: mappingNeeded })
        }
        if (confirmed.failed?.length) {
          issues.push({
            kind: 'failed',
            count: confirmed.failed.length,
            firstReason: confirmed.failed[0].reason,
          })
        }
      } else if (fileOnlyCount === 0) {
        // 변동·미매핑·미존재 모두 없음(전부 matched-equal) → PENDING 누적 방지 위해 APPLIED 마킹.
        // skip-marker 가 다음 실행에서 같은 스냅샷을 걸러낸다.
        await prisma.invReconciliation.update({
          where: { id: core.reconciliationId },
          data: { status: 'APPLIED' },
        })
      }

      if (fileOnlyCount > 0) {
        console.warn(
          `[cron/${WORKER_SERVICE}] space ${spaceId}: 미매핑(file-only) ${fileOnlyCount}건 — 사람 매핑 필요`
        )
        issues.push({ kind: 'file-only', count: fileOnlyCount })
      }

      if (issues.length > 0) {
        await notifyAutoReconciliation({
          spaceId,
          snapshotDate: parsed.snapshotDate,
          issues,
        }).catch((err) => console.warn(`[cron/${WORKER_SERVICE}] 알림 실패`, err))
      }

      summary.push({
        spaceId,
        status: 'ok',
        adjusted,
        fileOnly: fileOnlyCount,
        zeroed,
        mappingNeeded,
      })
    } catch (err) {
      console.error(`[cron/${WORKER_SERVICE}] space ${spaceId} 실패:`, err)
      summary.push({ spaceId, status: 'error' })
    }
  }

  await prisma.workerHeartbeat
    .upsert({
      where: { service: WORKER_SERVICE },
      create: { service: WORKER_SERVICE, lastPingAt: new Date() },
      update: { lastPingAt: new Date() },
    })
    .catch(() => {})

  return { spaces: summary }
}

export const GET = withCronRun('/api/cron/coupang-inventory-sync', runInventorySync, 'worker')
