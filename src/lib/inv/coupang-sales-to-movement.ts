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
// 재고 의미 (중요): 이 OUTBOUND 는 **재고를 차감한다(perpetual ledger)**.
// 자동 대조 cron 은 제거됐고, 재고 truth = OUTBOUND 차감 + 사용자 수동 대조 보정이다.
// 쿠팡 FC 입고(보충)는 워커가 수집하지 않으므로 재고가 하향 drift 하며, 사용자가
// 수동 재고이동(INBOUND) 또는 수동 대조(절대값 set)로 보정한다.
// (수동 대조 confirmReconciliation 은 fileQuantity 절대값 set 이라 drift 를 self-correct.)
// dated OUTBOUND 는 동시에 발주예측 수요 신호이기도 하다(buildDailySeries/accuracy.ts).

import { prisma } from '@/lib/prisma'
import { lockStockLevel } from '@/lib/inv/movement-processor'
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
  // 집계 (이력·Slack 표시용) — 해당 일자 로켓그로스 VENDOR 합
  revenue: number
  orderCount: number
  salesQty: number
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

  // 1) 해당 일자(KST) 로켓그로스 VENDOR 레코드.
  // salesQty 0 행도 포함한다 — 전체취소로 0이 된 옵션의 기존 OUTBOUND 를 0으로 정정해
  // 재고를 복원하기 위함(필터로 빼면 정정이 누락돼 재고가 과차감 상태로 남는다).
  // snapshotDate 가 정확한 timestamp 일 수 있어 동등 비교 대신 KST 일자 범위로 조회.
  const { startUtc, endUtc } = kstDayRange(date)
  const records = await prisma.inventoryRecord.findMany({
    where: {
      workspaceId,
      fileType: 'VENDOR_ITEM_METRICS',
      snapshotDate: { gte: startUtc, lt: endUtc },
      fulfillmentType: ROCKET_GROWTH_FULFILLMENT,
    },
    select: {
      productId: true,
      optionId: true,
      skuId: true,
      salesQty30d: true,
      revenue30d: true,
      orderCount: true,
    },
  })

  if (records.length === 0) {
    return {
      created: 0,
      updated: 0,
      skipped: 0,
      unmapped: 0,
      unmappedCodes: [],
      revenue: 0,
      orderCount: 0,
      salesQty: 0,
    }
  }

  // 집계 (이력·Slack 표시) — 로켓그로스 VENDOR 합. 매핑 성공 여부와 무관하게 수집된 실적.
  let aggRevenue = 0
  let aggOrder = 0
  let aggSalesQty = 0
  for (const r of records) {
    aggRevenue += r.revenue30d != null ? Number(r.revenue30d) : 0
    aggOrder += r.orderCount ?? 0
    aggSalesQty += r.salesQty30d ?? 0
  }

  // 1.5) optionId → skuId 브릿지 맵.
  // VENDOR 판매분석 export 에는 SKU 컬럼이 없어 skuId 가 항상 null 이다(라이브 export 확인).
  // 반면 위치 매핑(InvLocationProductMap.externalCode)과 재고 대조는 skuId(쿠팡 FC SKU) 기준이다.
  // → VENDOR optionId 를 inventory_health 의 (optionId→skuId) 로 해석해 매핑 키를 맞춘다.
  // optionId→skuId 는 1:1(검증됨). 날짜 매칭이 아니라 "전 기간 최신 스냅샷" 으로 맵을 만든다
  //   (과거 백필 날짜엔 그날 inventory_health 가 없을 수 있으므로 — 안정 속성).
  const vendorOptionIds = Array.from(
    new Set(records.map((r) => r.optionId).filter((v): v is string => !!v))
  )
  const optionToSku = new Map<string, string>()
  if (vendorOptionIds.length > 0) {
    const healthRows = await prisma.inventoryRecord.findMany({
      where: {
        workspaceId,
        fileType: 'INVENTORY_HEALTH',
        optionId: { in: vendorOptionIds },
        skuId: { not: null },
      },
      orderBy: { snapshotDate: 'desc' },
      select: { optionId: true, skuId: true },
    })
    // desc 정렬 → 첫 등장(최신)만 채택
    for (const h of healthRows) {
      if (h.optionId && h.skuId && !optionToSku.has(h.optionId)) {
        optionToSku.set(h.optionId, h.skuId)
      }
    }
  }

  // 2) externalCode → 매핑 일괄 로드 (matcher 와 동일 규칙: skuId 기준).
  // qty 0 도 키에 넣는다(전체취소 정정용). 음수는 방어적으로 0 처리.
  const codeToQty = new Map<string, number>() // externalCode(skuId) → 판매량
  for (const r of records) {
    // skuId 직접 → optionId 브릿지 → productId 순. 브릿지로 못 찾으면 optionId 원본 fallback
    // (매핑이 optionId 로 돼 있던 레거시 대비). 둘 다 mappingByCode 에서 걸러진다.
    const externalCode =
      r.skuId ?? (r.optionId ? optionToSku.get(r.optionId) : null) ?? r.optionId ?? r.productId
    if (!externalCode) continue
    const qty = Math.max(0, r.salesQty30d ?? 0)
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
    revenue: aggRevenue,
    orderCount: aggOrder,
    salesQty: aggSalesQty,
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

  // 3) 옵션별 OUTBOUND upsert (referenceId 멱등). quantity 0 은 기존 OUTBOUND 정정용
  //    (전체취소) — upsert 내부에서 기존이 없으면 skip 한다.
  for (const [optionId, quantity] of optionQty) {
    if (quantity < 0) continue
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
 * referenceId 로 식별되는 dated OUTBOUND 이동을 멱등하게 보장한다(**재고 차감**).
 * - 없음 → 생성 + 재고 차감
 * - 동일 수량 → skip
 * - 수량 변경(취소/정정) → 같은 트랜잭션에서 delta(신규−기존)만큼 재고 조정 + 이동 갱신
 *
 * 재고 truth = OUTBOUND 차감 + 수동 대조 보정(모듈 상단 주석 참고). 정정은 delete+recreate
 * 대신 **delta 한 번에 적용**해 원자성·역산을 보장한다(중간 실패로 인한 재고 누수 방지).
 * lockStockLevel 로 행 잠금. 음수 재고는 허용(입고 미수집 drift, 수동 보정 전제) — warning.
 * 미사용 옵션 OUTBOUND 방지 위해 옵션 ACTIVE/소유권 검증.
 */
export async function upsertOutboundMovement(input: {
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
    // referenceId 단위 직렬화 — findFirst→create 사이 race로 동일 referenceId OUTBOUND가
    // 중복 생성(재고 이중 차감)되는 것을 방지. referenceId에 유니크 제약을 걸 수 없어
    // (재고대조·세트이관이 여러 행에 공유) 트랜잭션 스코프 advisory lock으로 대체.
    // hashtext는 int4 반환 → pg_advisory_xact_lock(bigint) 암시적 캐스트로 동작함.
    // $queryRaw는 void 반환 컬럼을 역직렬화하지 못하므로 $executeRaw 사용.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${referenceId}))`

    const option = await tx.invProductOption.findFirst({
      where: { id: optionId, product: { spaceId, status: 'ACTIVE' } },
      select: { id: true },
    })
    if (!option) return 'skipped'

    const existing = await tx.invMovement.findFirst({
      where: { referenceId, type: 'OUTBOUND' },
    })
    if (existing && existing.quantity === quantity) return 'skipped'
    // 신규인데 0 이면 만들 OUTBOUND 가 없음(전체취소 정정 대상도 없음).
    if (!existing && quantity <= 0) return 'skipped'

    // delta 만큼 재고 차감: 신규 OUTBOUND = quantity 차감, 정정 = (quantity − 기존) 차감.
    // (기존이 이미 차감했으므로 차분만 추가 적용 = 역산+재적용을 한 번에.)
    // 전체취소(quantity 0)면 delta = −기존수량 → 기존 차감분이 전부 복원된다.
    const delta = quantity - (existing?.quantity ?? 0)

    await lockStockLevel(tx, optionId, locationId)
    const stock = await tx.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId, locationId } },
    })
    const before = stock?.quantity ?? 0
    const after = before - delta
    if (stock) {
      await tx.invStockLevel.update({ where: { id: stock.id }, data: { quantity: after } })
    } else {
      await tx.invStockLevel.create({ data: { spaceId, optionId, locationId, quantity: after } })
    }
    if (after < 0) {
      console.warn(
        `[coupang-sales] 재고 음수 (option ${optionId} loc ${locationId}): ${before} → ${after}. 수동 보정 필요.`
      )
    }

    if (existing) {
      // 전체취소(0) 면 OUTBOUND 자체를 삭제(0 짜리 잔존 방지). 그 외엔 수량 갱신.
      if (quantity <= 0) {
        await tx.invMovement.delete({ where: { id: existing.id } })
      } else {
        await tx.invMovement.update({
          where: { id: existing.id },
          data: { quantity, movementDate, channelId, locationId },
        })
      }
      return 'updated'
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
    return 'created'
  })
}

// ─── 멀티 Space 오케스트레이션 (일일 cron + 백필 range 공유) ──────────────────────

export type SalesSyncSpaceSummary = {
  spaceId: string
  workspaceId?: string // 변환 대상 워크스페이스 (이력 잡 기록용)
  status: string
  created?: number
  updated?: number
  skipped?: number
  unmapped?: number
  // 집계 (이력·Slack 표시)
  revenue?: number
  orderCount?: number
  salesQty?: number
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
      let revenue = 0
      let orderCount = 0
      let salesQty = 0
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
        revenue += r.revenue
        orderCount += r.orderCount
        salesQty += r.salesQty
        if (r.unmapped > 0) {
          console.warn(
            `[coupang-sales-sync] space ${spaceId} ${date.toISOString().slice(0, 10)}: 미매핑 ${r.unmapped}건`,
            r.unmappedCodes.slice(0, 20)
          )
        }
      }
      summary.push({
        spaceId,
        workspaceId: resolved.workspaceId,
        status: 'ok',
        created,
        updated,
        skipped,
        unmapped,
        revenue,
        orderCount,
        salesQty,
      })
    } catch (err) {
      console.error(`[coupang-sales-sync] space ${spaceId} 실패:`, err)
      summary.push({ spaceId, status: 'error' })
    }
  }

  return summary
}

/**
 * Space 의 쿠팡 로켓그로스 판매 귀속 채널 조회 — externalSource 로 결정적.
 * (위치와 동일 패턴: `@@unique([spaceId, externalSource])` 로 공간당 1개 보장.)
 * 무음 생성하지 않는다 — 없으면 호출자가 skip. 페어링은 연동 시점에 생성.
 */
async function findCoupangSalesChannel(spaceId: string): Promise<{ id: string } | null> {
  return prisma.channel.findFirst({
    where: {
      spaceId,
      isActive: true,
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
    },
    select: { id: true },
  })
}

// ─── 판매분석 옵션별 시계열 (재고 차감과 무관, 조회 전용) ──────────────────────
//
// 판매분석 "상품(옵션)" 탭이 로켓그로스 일자×옵션 판매량을 그릴 때 쓴다.
// syncCoupangSalesMovements 와 **동일한 매핑 규칙**(skuId→optionId 브릿지→productId →
// InvLocationProductMap → items[].optionId, 1:N 묶음은 salesQty×item.quantity)으로 내부
// InvProductOption 에 귀속하되, OUTBOUND 를 쓰지 않고 원본 InventoryRecord 에서 재집계한다.
// OUTBOUND 는 비-ACTIVE 옵션 skip·cron 의존이라 과거 이력이 빠질 수 있으므로 조회엔 원본이 안전.

export type RocketOptionQtyRow = {
  date: string // YYYY-MM-DD (KST)
  optionId: string // 내부 InvProductOption.id
  optionName: string // 옵션명 (InvProductOption.name)
  productId: string // 내부 InvProduct.id
  productName: string // 상품명 (관리명 우선)
  quantity: number // 구성 옵션 단위 판매량 (1:N 묶음 분해 반영)
}

/** 옵션 메타 부재(FK 정합 깨짐) 시 묶음용 sentinel 상품 id — 카탈로그 유령 상품 분열 방지. */
const UNKNOWN_PRODUCT_ID = '__unknown_product__'

/** Date → KST 일자 키 (revenue API 와 동일 규칙). */
function toKstDateKeyPublic(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 한 Space 의 기간 [from, to] 로켓그로스 일자×내부옵션 판매량을 집계한다(재고 미차감, 조회 전용).
 * 미매핑 externalCode 는 제외된다(sync 의 unmapped 와 동일 — 무음 누락 방지 위해 호출부에서 표기 가능).
 *
 * @returns 일자×옵션 행 배열. 로켓 미연동(workspace/location 링크 없음)이면 빈 배열.
 */
export async function loadRocketDailyOptionQty(
  spaceId: string,
  from: Date,
  to: Date
): Promise<RocketOptionQtyRow[]> {
  const resolved = await resolveCoupangWorkspaceForSpace(spaceId)
  if (!resolved) return []
  const { workspaceId, locationId } = resolved

  // from/to 의 KST 일자를 KST 자정 instant 범위로 정규화 (snapshotDate 저장 형식과 정렬).
  const gte = new Date(`${toKstDateKeyPublic(from)}T00:00:00+09:00`)
  const ltExclusive = new Date(`${toKstDateKeyPublic(to)}T00:00:00+09:00`)
  ltExclusive.setTime(ltExclusive.getTime() + 24 * 60 * 60 * 1000) // to 일자 포함

  const records = await prisma.inventoryRecord.findMany({
    where: {
      workspaceId,
      fileType: 'VENDOR_ITEM_METRICS',
      fulfillmentType: ROCKET_GROWTH_FULFILLMENT,
      snapshotDate: { gte, lt: ltExclusive },
    },
    select: { snapshotDate: true, productId: true, optionId: true, skuId: true, salesQty30d: true },
  })
  if (records.length === 0) return []

  // optionId → skuId 브릿지 (전 기간 최신 inventory_health 스냅샷, 1:1). sync 와 동일.
  const vendorOptionIds = Array.from(
    new Set(records.map((r) => r.optionId).filter((v): v is string => !!v))
  )
  const optionToSku = new Map<string, string>()
  if (vendorOptionIds.length > 0) {
    const healthRows = await prisma.inventoryRecord.findMany({
      where: {
        workspaceId,
        fileType: 'INVENTORY_HEALTH',
        optionId: { in: vendorOptionIds },
        skuId: { not: null },
      },
      orderBy: { snapshotDate: 'desc' },
      select: { optionId: true, skuId: true },
    })
    for (const h of healthRows) {
      if (h.optionId && h.skuId && !optionToSku.has(h.optionId)) {
        optionToSku.set(h.optionId, h.skuId)
      }
    }
  }

  // externalCode 결정 (sku 직접 → 브릿지 → optionId → productId). sync 와 동일 규칙.
  const externalCodeFor = (r: (typeof records)[number]): string | null =>
    r.skuId ??
    (r.optionId ? (optionToSku.get(r.optionId) ?? null) : null) ??
    r.optionId ??
    r.productId

  const externalCodes = Array.from(
    new Set(records.map(externalCodeFor).filter((v): v is string => !!v))
  )
  const mappings = externalCodes.length
    ? await prisma.invLocationProductMap.findMany({
        where: { locationId, externalCode: { in: externalCodes } },
        include: { items: { select: { optionId: true, quantity: true } } },
      })
    : []
  const mappingByCode = new Map(mappings.map((m) => [m.externalCode, m]))

  // 내부 옵션명 (관리명 우선). 매핑 대상 옵션만.
  const mappedOptionIds = Array.from(
    new Set(mappings.flatMap((m) => m.items.map((i) => i.optionId)))
  )
  const optionMeta = mappedOptionIds.length
    ? await prisma.invProductOption.findMany({
        where: { id: { in: mappedOptionIds } },
        select: {
          id: true,
          name: true,
          productId: true,
          product: { select: { name: true, internalName: true } },
        },
      })
    : []
  const metaByOption = new Map(
    optionMeta.map((o) => {
      const internal = o.product.internalName?.trim()
      const productName = internal && internal.length > 0 ? internal : o.product.name
      return [o.id, { optionName: o.name, productId: o.productId, productName }]
    })
  )

  // (date, internalOptionId) → qty 합산. 1:N 묶음은 salesQty×item.quantity 로 분해.
  const byKey = new Map<string, RocketOptionQtyRow>()
  for (const r of records) {
    const qty = Math.max(0, r.salesQty30d ?? 0)
    if (qty <= 0) continue
    const code = externalCodeFor(r)
    if (!code) continue
    const mapping = mappingByCode.get(code)
    if (!mapping || mapping.items.length === 0) continue // 미매핑 제외
    const date = toKstDateKeyPublic(r.snapshotDate)
    for (const item of mapping.items) {
      const optQty = qty * item.quantity
      if (optQty <= 0) continue
      const key = `${date}|${item.optionId}`
      const meta = metaByOption.get(item.optionId)
      // meta 부재(매핑 optionId 가 삭제된 옵션을 가리키는 등 FK 정합 깨짐)는 단일 sentinel
      // 상품으로 묶는다 — optionId 를 productId 로 쓰면 카탈로그가 옵션마다 유령 상품으로 쪼개진다.
      const entry =
        byKey.get(key) ??
        ({
          date,
          optionId: item.optionId,
          optionName: meta?.optionName ?? '(미상 옵션)',
          productId: meta?.productId ?? UNKNOWN_PRODUCT_ID,
          productName: meta?.productName ?? '(미상 상품)',
          quantity: 0,
        } satisfies RocketOptionQtyRow)
      entry.quantity += optQty
      byKey.set(key, entry)
    }
  }

  return Array.from(byKey.values())
}
