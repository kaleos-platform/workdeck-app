// 쿠팡 판매분석(VENDOR_ITEM_METRICS) 로켓그로스 판매량 → OUTBOUND 이동 변환.
//
// 흐름:
//   1) 해당 일자의 VENDOR 레코드 중 판매방식=로켓그로스 + 판매량>0 행 로드
//   2) externalCode(skuId ?? optionId ?? productId) → InvLocationProductMap → 옵션(들) 매핑
//      (재고 대조 matcher 와 동일 규칙. 1:N 묶음은 item.quantity 비율 분배.)
//   3) 옵션×일자별 OUTBOUND 생성. referenceId 로 멱등 — 재수집 시 수량 갱신(취소/정정 반영).
//
// 무중복: 판매자배송 행은 제외한다. 쿠팡 판매자배송 주문은 이미 워크덱 배송(DelBatch)
// 으로 업로드되어 OUTBOUND 가 생성되므로, 여기서 또 기록하면 이중 계산된다.
//
// 재고 의미 (중요): 이 OUTBOUND 는 **항상 재고를 차감하지 않는다(stock-neutral)**.
// 재고 truth 는 오직 inventory_health 일별 자동 대조(coupang-inventory-sync, 절대값 set)가
// 책임진다. 같은 워커 실행이 VENDOR 와 inventory_health 스냅샷을 함께 만들고, 대조가
// 매일 아침 그 스냅샷을 절대값으로 반영하므로, 여기서 또 차감하면 항상 이중 차감이다
// (차감이 도움 되는 상태가 존재하지 않음). 따라서 dated OUTBOUND 는 발주예측 history
// 전용 — buildDailySeries / accuracy.ts 가 읽으며 둘 다 stock-equality 를 검사하지 않는다.

import { prisma } from '@/lib/prisma'
import { COUPANG_ADS_DECK_ID } from '@/lib/deck-routes'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'

const ROCKET_GROWTH_FULFILLMENT = '로켓그로스'

/** 판매분석 OUTBOUND 의 referenceId — 옵션×일자 단위 멱등 키. */
export function coupangSalesReferenceId(date: Date, optionId: string): string {
  return `coupang-sales:${toDateKey(date)}:${optionId}`
}

function toDateKey(date: Date): string {
  // KST 일자 기준 YYYY-MM-DD
  const kst = new Date(date.getTime() + 9 * 3600 * 1000)
  return kst.toISOString().slice(0, 10)
}

/** date 가 속한 KST 일자 [00:00, 24:00) 의 UTC 범위. */
function kstDayRange(date: Date): { startUtc: Date; endUtc: Date } {
  const key = toDateKey(date) // KST YYYY-MM-DD
  // KST 자정 = UTC 전날 15:00
  const startUtc = new Date(`${key}T00:00:00+09:00`)
  const endUtc = new Date(startUtc.getTime() + 24 * 3600 * 1000)
  return { startUtc, endUtc }
}

export type SyncCoupangSalesResult = {
  created: number
  updated: number
  skipped: number
  unmapped: number
  unmappedCodes: string[]
}

/**
 * 한 Space 의 특정 일자 로켓그로스 판매를 OUTBOUND 이동으로 동기화한다.
 * snapshotDate 는 VENDOR 레코드의 저장 키(워커가 수집 대상 일자로 저장).
 */
export async function syncCoupangSalesMovements(params: {
  spaceId: string
  workspaceId: string
  locationId: string
  channelId: string
  date: Date // 판매 일자 (VENDOR snapshotDate)
}): Promise<SyncCoupangSalesResult> {
  const { spaceId, workspaceId, locationId, channelId, date } = params

  // 1) 해당 일자(KST) 로켓그로스 VENDOR 레코드 (판매량>0)
  // snapshotDate 가 정확한 timestamp 일 수 있어 동등 비교 대신 KST 일자 범위로 조회.
  const { startUtc, endUtc } = kstDayRange(date)
  const records = await prisma.inventoryRecord.findMany({
    where: {
      workspaceId,
      fileType: 'VENDOR_ITEM_METRICS',
      snapshotDate: { gte: startUtc, lt: endUtc },
      fulfillmentType: ROCKET_GROWTH_FULFILLMENT,
      salesQty30d: { gt: 0 }, // VENDOR 파서가 '판매량'을 salesQty30d 로 매핑
    },
    select: {
      productId: true,
      optionId: true,
      skuId: true,
      salesQty30d: true,
    },
  })

  if (records.length === 0) {
    return { created: 0, updated: 0, skipped: 0, unmapped: 0, unmappedCodes: [] }
  }

  // 2) externalCode → 매핑 일괄 로드 (matcher 와 동일 규칙)
  const codeToQty = new Map<string, number>() // externalCode → 판매량
  for (const r of records) {
    const externalCode = r.skuId ?? r.optionId ?? r.productId
    if (!externalCode) continue
    const qty = r.salesQty30d ?? 0
    if (qty <= 0) continue
    codeToQty.set(externalCode, (codeToQty.get(externalCode) ?? 0) + qty)
  }

  const externalCodes = Array.from(codeToQty.keys())
  const mappings = externalCodes.length
    ? await prisma.invLocationProductMap.findMany({
        where: { locationId, externalCode: { in: externalCodes } },
        include: { items: { select: { optionId: true, quantity: true } } },
      })
    : []
  const mappingByCode = new Map(mappings.map((m) => [m.externalCode, m]))

  const result: SyncCoupangSalesResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    unmapped: 0,
    unmappedCodes: [],
  }

  // 옵션별 합산 수량 (서로 다른 externalCode 가 같은 옵션을 가리킬 수 있음)
  const optionQty = new Map<string, number>()
  for (const [code, salesQty] of codeToQty) {
    const mapping = mappingByCode.get(code)
    if (!mapping || mapping.items.length === 0) {
      result.unmapped += 1
      result.unmappedCodes.push(code)
      continue
    }
    for (const item of mapping.items) {
      // 1:N 묶음: 판매 1건당 item.quantity 만큼 옵션 출고
      const optQty = salesQty * item.quantity
      optionQty.set(item.optionId, (optionQty.get(item.optionId) ?? 0) + optQty)
    }
  }

  // 3) 옵션별 OUTBOUND upsert (referenceId 멱등)
  for (const [optionId, quantity] of optionQty) {
    if (quantity <= 0) continue
    const referenceId = coupangSalesReferenceId(date, optionId)
    const outcome = await upsertOutboundMovement({
      spaceId,
      optionId,
      locationId,
      channelId,
      quantity,
      movementDate: date,
      referenceId,
    })
    result[outcome] += 1
  }

  return result
}

/**
 * referenceId 로 식별되는 dated OUTBOUND 이동을 멱등하게 보장한다(stock-neutral).
 * - 없음 → 생성
 * - 동일 수량 → skip
 * - 수량 변경(취소/정정) → 삭제 후 재생성
 *
 * **재고를 차감하지 않는다.** 재고 truth 는 inventory_health 대조(절대값 set)가 책임지고,
 * 이 이동은 발주예측 history 전용이다. (모듈 상단 주석 참고.)
 * 미사용 옵션 OUTBOUND 방지 위해 옵션 ACTIVE/소유권만 검증.
 */
async function upsertOutboundMovement(input: {
  spaceId: string
  optionId: string
  locationId: string
  channelId: string
  quantity: number
  movementDate: Date
  referenceId: string
}): Promise<'created' | 'updated' | 'skipped'> {
  const { spaceId, optionId, locationId, channelId, quantity, movementDate, referenceId } = input

  return await prisma.$transaction(async (tx) => {
    const option = await tx.invProductOption.findFirst({
      where: { id: optionId, product: { spaceId, status: 'ACTIVE' } },
      select: { id: true },
    })
    if (!option) return 'skipped'

    const existing = await tx.invMovement.findFirst({
      where: { referenceId, type: 'OUTBOUND' },
    })

    if (existing) {
      if (existing.quantity === quantity) return 'skipped'
      // 수량 변경(정정/취소) → 삭제 후 재생성. 재고 미차감이라 역산 불필요.
      await tx.invMovement.delete({ where: { id: existing.id } })
    }

    await tx.invMovement.create({
      data: {
        spaceId,
        optionId,
        locationId,
        channelId,
        type: 'OUTBOUND',
        quantity,
        movementDate,
        referenceId,
      },
    })

    return existing ? 'updated' : 'created'
  })
}

// ─── 멀티 Space 오케스트레이션 (일일 cron + 백필 range 공유) ──────────────────────

export type SalesSyncSpaceSummary = {
  spaceId: string
  status: string
  created?: number
  updated?: number
  skipped?: number
  unmapped?: number
}

/**
 * 로켓그로스 위치·매핑·coupang Deck 활성 Space 를 추려, 주어진 일자들의 판매를
 * dated OUTBOUND(stock-neutral, 발주예측 history 전용)로 변환한다.
 * 일일 cron(어제 1일)과 백필 range(과거 N일)가 동일 경로를 공유한다 — 둘 다 재고 미차감.
 *
 * @param dates 변환 대상 일자(KST 자정 Date) 배열
 */
export async function runCoupangSalesSyncForDates(dates: Date[]): Promise<SalesSyncSpaceSummary[]> {
  const locations = await prisma.invStorageLocation.findMany({
    where: {
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
      isActive: true,
      locationMappings: { some: {} },
    },
    select: { spaceId: true },
    distinct: ['spaceId'],
  })

  const summary: SalesSyncSpaceSummary[] = []

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

      const channel = await findCoupangSalesChannel(spaceId)
      if (!channel) {
        console.warn(`[coupang-sales-sync] space ${spaceId}: 쿠팡 판매채널 없음 → skip`)
        summary.push({ spaceId, status: 'skip:no-channel' })
        continue
      }

      let created = 0
      let updated = 0
      let skipped = 0
      let unmapped = 0
      for (const date of dates) {
        const r = await syncCoupangSalesMovements({
          spaceId,
          workspaceId: resolved.workspaceId,
          locationId: resolved.locationId,
          channelId: channel.id,
          date,
        })
        created += r.created
        updated += r.updated
        skipped += r.skipped
        unmapped += r.unmapped
        if (r.unmapped > 0) {
          console.warn(
            `[coupang-sales-sync] space ${spaceId} ${date.toISOString().slice(0, 10)}: 미매핑 ${r.unmapped}건`,
            r.unmappedCodes.slice(0, 20)
          )
        }
      }
      summary.push({ spaceId, status: 'ok', created, updated, skipped, unmapped })
    } catch (err) {
      console.error(`[coupang-sales-sync] space ${spaceId} 실패:`, err)
      summary.push({ spaceId, status: 'error' })
    }
  }

  return summary
}

/**
 * Space 의 쿠팡 판매 귀속 채널 조회. 이름에 "쿠팡" 포함 + 판매채널 타입.
 * 무음 생성하지 않는다 — 없으면 호출자가 skip. (사용자 가시 엔티티)
 */
async function findCoupangSalesChannel(spaceId: string): Promise<{ id: string } | null> {
  return prisma.channel.findFirst({
    where: {
      spaceId,
      isActive: true,
      name: { contains: '쿠팡' },
      channelTypeDef: { isSalesChannel: true },
    },
    select: { id: true },
    orderBy: { sortOrder: 'asc' },
  })
}
