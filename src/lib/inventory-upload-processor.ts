import { prisma } from '@/lib/prisma'
import { parseInventoryExcel } from '@/lib/inventory-parser'
import type { InventoryFileType } from '@/lib/inventory-parser'
import type { CoupangDataSource } from '@/generated/prisma/client'
import { resolveOptionIdentity } from '@/lib/collection/resolve-product-id'
import type { ApiOptionIdentity } from '@/lib/collection/resolve-product-id'

export type InventoryUploadResult = {
  success: true
  uploadId: string
  fileType: InventoryFileType
  totalRows: number
  insertedRows: number
}

export type InventoryUploadError = {
  success: false
  error: string
}

const BATCH_SIZE = 2000

export async function processInventoryUpload(params: {
  workspaceId: string
  fileName: string
  buffer: ArrayBuffer
  snapshotDate: Date
  source?: CoupangDataSource
}): Promise<InventoryUploadResult | InventoryUploadError> {
  const { workspaceId, fileName, buffer, snapshotDate, source = 'CRAWL' } = params

  // 1. 파싱
  let parsed
  try {
    parsed = parseInventoryExcel(buffer)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '파싱 실패',
    }
  }

  if (parsed.rows.length === 0) {
    return { success: false, error: '파싱된 데이터가 없습니다' }
  }

  // 1.5. 완전성 가드 (INVENTORY_HEALTH 한정)
  // 부분 export(그리드 미완전 로드 상태에서 다운로드) 차단. 절대 임계 대신
  // 이력 앵커로 셀러 규모에 자동 적응한다. VENDOR는 날짜별 판매량 변동이 커 적용하지 않는다.
  //
  // 앵커는 "직전 1건"이 아니라 "최근 N건의 MAX"를 쓴다 — 직전 1건만 보면 가드 도입 전
  // 이미 적재된 부분 export(예: 2행)를 정상 baseline 으로 신뢰해 임계가 무력화되기 때문.
  // MAX 는 corruption 1건이 섞여도 정상 규모를 유지한다.
  if (parsed.fileType === 'INVENTORY_HEALTH') {
    // baseline은 source별로 분리 조회한다 — 크롤링 HEALTH 행과 API 요약 행은 모집단
    // 자체가 달라서, baseline을 공유하면 첫 API 수집이 영구히 가드에 걸리거나(행이
    // 적을 때) 반대로 그냥 통과해 덮어쓴다(행이 많을 때).
    const recent = await prisma.inventoryUpload.findMany({
      where: { workspaceId, fileType: 'INVENTORY_HEALTH', source, insertedRows: { gt: 0 } },
      orderBy: { uploadedAt: 'desc' },
      take: 10,
      select: { insertedRows: true },
    })
    const baseline = recent.reduce((max, u) => Math.max(max, u.insertedRows ?? 0), 0)
    if (baseline > 0 && parsed.rows.length < baseline * 0.5) {
      return {
        success: false,
        error:
          `재고현황 데이터가 비정상적으로 적습니다 (${parsed.rows.length}행, 최근 최대 ${baseline}행 대비 50% 미만). ` +
          `Wing 그리드가 완전히 로드되기 전 부분 export 되었을 수 있어 적재를 중단합니다.`,
      }
    }
  }

  // 2~5. 업로드 이력 생성 → 기존 스냅샷 삭제 → 벌크 삽입을 단일 트랜잭션으로 원자 처리한다.
  //      삭제 후 삽입 중 실패 시 기존 스냅샷 삭제까지 롤백되어 해당 날짜 데이터가 유실되는 것을 방지한다.
  try {
    const saved = await prisma.$transaction(
      async (tx) => {
        // 업로드 레코드 생성
        const upload = await tx.inventoryUpload.create({
          data: {
            workspaceId,
            fileName,
            fileType: parsed.fileType,
            snapshotDate,
            totalRows: parsed.rows.length,
            source,
          },
        })

        // 기존 동일 스냅샷 + 동일 fileType 데이터 삭제 (덮어쓰기)
        const oldUploads = await tx.inventoryUpload.findMany({
          where: { workspaceId, snapshotDate, fileType: parsed.fileType, id: { not: upload.id } },
          select: { id: true },
        })
        if (oldUploads.length > 0) {
          const oldIds = oldUploads.map((u) => u.id)
          await tx.inventoryRecord.deleteMany({ where: { uploadId: { in: oldIds } } })
          // 고아 업로드 레코드도 정리
          await tx.inventoryUpload.deleteMany({ where: { id: { in: oldIds } } })
        }

        // 벌크 삽입
        let insertedRows = 0
        for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
          const batch = parsed.rows.slice(i, i + BATCH_SIZE)
          const result = await tx.inventoryRecord.createMany({
            data: batch.map((row) => ({
              workspaceId,
              snapshotDate,
              fileType: parsed.fileType,
              source,
              uploadId: upload.id,
              productId: row.productId,
              optionId: row.optionId,
              skuId: row.skuId,
              productName: row.productName,
              optionName: row.optionName,
              category: row.category,
              availableStock: row.availableStock,
              inboundStock: row.inboundStock,
              productGrade: row.productGrade,
              restockQty: row.restockQty,
              restockDate: row.restockDate,
              estimatedDepletion: row.estimatedDepletion,
              storageFee: row.storageFee,
              isItemWinner: row.isItemWinner,
              returns30d: row.returns30d,
              revenue7d: row.revenue7d,
              revenue30d: row.revenue30d,
              salesQty7d: row.salesQty7d,
              salesQty30d: row.salesQty30d,
              orderCount: row.orderCount,
              fulfillmentType: row.fulfillmentType,
              visitors: row.visitors,
              views: row.views,
              cartAdds: row.cartAdds,
              conversionRate: row.conversionRate,
              itemWinnerRate: row.itemWinnerRate,
              totalRevenue: row.totalRevenue,
              totalSales: row.totalSales,
              totalCancelAmt: row.totalCancelAmt,
              totalCancelled: row.totalCancelled,
              stock1to30d: row.stock1to30d,
              stock31to45d: row.stock31to45d,
              stock46to60d: row.stock46to60d,
              stock61to120d: row.stock61to120d,
              stock121to180d: row.stock121to180d,
              stock181plusD: row.stock181plusD,
            })),
            skipDuplicates: true,
          })
          insertedRows += result.count
        }

        // 업로드 레코드에 실적재 행수 기록
        await tx.inventoryUpload.update({
          where: { id: upload.id },
          data: { insertedRows },
        })

        return { uploadId: upload.id, insertedRows }
      },
      { maxWait: 10_000, timeout: 120_000 }
    )

    return {
      success: true,
      uploadId: saved.uploadId,
      fileType: parsed.fileType,
      totalRows: parsed.rows.length,
      insertedRows: saved.insertedRows,
    }
  } catch (err) {
    // 트랜잭션 롤백 — 기존 스냅샷은 그대로 보존된다
    return {
      success: false,
      error: `데이터 저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }
}

// ─── 쿠팡 재고 API 적재 경로 ──────────────────────────────────────────────────────
// 워커는 Prisma 의존이 없어(worker/package.json) optionId->{productId,productName,
// optionName} 이력 역산을 할 수 없다. 그래서 워커는 그 셋 없이 rows 만 보내고, 앱(여기)이
// resolveOptionIdentity() 로 채운다. 상품 API 매핑(apiProductMap)은 워커가 이력으로
// 못 채운 옵션이 남았을 때만 동봉한다(계획서 §D/§E, team-lead 반려 후 productName·
// optionName 도 이력 역산으로 확장).

/** API 소스 행 — productId/productName/optionName 은 워커가 모르므로 없음(앱이 채운다). */
export type InventoryApiRowInput = {
  optionId: string
  skuId: string | null
  orderableQuantity: number | null
  salesQty30d: number | null
}

export type InventoryApiUploadResult = {
  success: true
  uploadId: string
  fileType: InventoryFileType
  totalRows: number
  insertedRows: number
  /** productId 미해결로 적재에서 제외된 행 수 (실측 기준 0건이지만 0이 아니면 운영자가 알아야 한다) */
  skippedUnresolved: number
  /** 미해결 optionId 목록 — 워커가 상품 API 로 apiProductMap 을 만들어 재시도할 때 사용 */
  unresolvedOptionIds: string[]
}

const API_INVENTORY_FILE_TYPES: readonly InventoryFileType[] = ['INVENTORY_HEALTH']

export async function processInventoryApiRows(params: {
  workspaceId: string
  fileType: InventoryFileType
  snapshotDate: Date
  rows: InventoryApiRowInput[]
  /** 상품 API 로 확보한 optionId->{productId,productName,optionName} 보강 매핑 (이력에 없는 옵션 전용) */
  apiProductMap?: Record<string, ApiOptionIdentity>
  /** true 면 페이징이 nextToken 잔여로 끊겼거나 429 재시도가 소진된 것 — 적재 거부 */
  truncated?: boolean
}): Promise<InventoryApiUploadResult | InventoryUploadError> {
  const { workspaceId, fileType, snapshotDate, rows, apiProductMap, truncated } = params

  if (!API_INVENTORY_FILE_TYPES.includes(fileType)) {
    return {
      success: false,
      error: `API 소스는 ${API_INVENTORY_FILE_TYPES.join(', ')} 만 지원합니다`,
    }
  }

  if (truncated) {
    return {
      success: false,
      error:
        '재고 API 수집이 완료되지 않았습니다(nextToken 잔여 또는 429 재시도 소진) — 부분 데이터 적재를 거부합니다.',
    }
  }

  if (rows.length === 0) {
    return { success: false, error: '적재할 API 재고 행이 없습니다' }
  }

  // 완전성 가드 — source='API' baseline (파일 업로드 경로와 동일 원칙, 모집단이 다르므로 분리 조회)
  const recent = await prisma.inventoryUpload.findMany({
    where: { workspaceId, fileType, source: 'API', insertedRows: { gt: 0 } },
    orderBy: { uploadedAt: 'desc' },
    take: 10,
    select: { insertedRows: true },
  })
  const baseline = recent.reduce((max, u) => Math.max(max, u.insertedRows ?? 0), 0)

  // productId·productName·optionName 해석 — 이력 우선, 없으면 apiProductMap, 그래도
  // 없으면 unresolved(적재 제외). productName 은 플레이스홀더로 채우지 않는다 — 재고현황
  // 화면·미매칭 다이얼로그에 그대로 노출되므로 실제 값이 없으면 스킵한다(team-lead 반려).
  const optionIds = rows.map((r) => r.optionId)
  const { resolved, unresolved } = await resolveOptionIdentity(
    workspaceId,
    optionIds,
    apiProductMap
  )
  const resolvedRows = rows.filter((r) => resolved.has(r.optionId))
  const skippedUnresolved = rows.length - resolvedRows.length

  if (unresolved.length > 0) {
    console.warn(
      `[inventory-upload-processor] productId/productName 미해결 옵션 ${unresolved.length}건 — 적재 제외:`,
      unresolved.slice(0, 20)
    )
  }

  // 완전성 가드 — 반드시 **해석 후 실제 적재 행 수**로 판정한다.
  //
  // 수집 행 수(rows.length)로 판정하면 해석기가 실패했을 때(쿼리 오류·workspaceId 불일치·
  // 이력 유실·apiProductMap 누락) 가드를 그대로 통과하고, 아래 삭제-후-삽입이 그날 스냅샷을
  // 소수의 행으로 갈아버린다. 무인 cron 경로라 사람이 중간에 못 막는다 — 이 가드가 존재하는
  // 이유가 정확히 그 사고다.
  //
  // 에러 메시지에 수집 행 수와 해석 행 수를 모두 남긴다: 원인이 "적게 걷혔다"인지
  // "해석에 실패했다"인지 운영자가 구별할 수 있어야 한다.
  if (baseline > 0 && resolvedRows.length < baseline * 0.5) {
    return {
      success: false,
      error:
        `API 재고 적재 대상이 비정상적으로 적습니다 ` +
        `(수집 ${rows.length}행 → 해석 ${resolvedRows.length}행, 최근 최대 ${baseline}행 대비 50% 미만). ` +
        `적재를 중단합니다.`,
    }
  }

  try {
    const saved = await prisma.$transaction(
      async (tx) => {
        const upload = await tx.inventoryUpload.create({
          data: {
            workspaceId,
            fileName: `coupang-api-${fileType.toLowerCase()}`,
            fileType,
            snapshotDate,
            totalRows: rows.length,
            source: 'API',
          },
        })

        // 기존 동일 스냅샷 + 동일 fileType 데이터 삭제 — source 를 가리지 않는다. 같은 날
        // 크롤링과 API 가 둘 다 돌면(예: 소스 전환 당일, 수동 재수집) 나중에 들어온 쪽이
        // 앞선 쪽을 덮어쓰는 게 의도된 동작이다(계획서: "삭제-후-삽입이 소스 전환 시
        // 덮어쓰기로 동작하는 게 정답"). InventoryRecord.source 는 사후 판별용일 뿐 unique
        // 키에 없으므로, 여기서 source 로 필터링하면 오히려 같은 스냅샷에 CRAWL/API 행이
        // 공존해 다운스트림(OUTBOUND, 발주 수요)이 이중계상된다.
        const oldUploads = await tx.inventoryUpload.findMany({
          where: { workspaceId, snapshotDate, fileType, id: { not: upload.id } },
          select: { id: true },
        })
        if (oldUploads.length > 0) {
          const oldIds = oldUploads.map((u) => u.id)
          await tx.inventoryRecord.deleteMany({ where: { uploadId: { in: oldIds } } })
          await tx.inventoryUpload.deleteMany({ where: { id: { in: oldIds } } })
        }

        let insertedRows = 0
        for (let i = 0; i < resolvedRows.length; i += BATCH_SIZE) {
          const batch = resolvedRows.slice(i, i + BATCH_SIZE)
          const result = await tx.inventoryRecord.createMany({
            data: batch.map((row) => {
              const identity = resolved.get(row.optionId)!
              return {
                workspaceId,
                snapshotDate,
                fileType,
                source: 'API' as CoupangDataSource,
                uploadId: upload.id,
                productId: identity.productId,
                optionId: row.optionId,
                skuId: row.skuId,
                productName: identity.productName,
                optionName: identity.optionName,
                availableStock: row.orderableQuantity,
                salesQty30d: row.salesQty30d,
                // 나머지(보관일수·입고예정·판매불가재고 등)는 API 가 안 줘서 null 로 남긴다.
              }
            }),
            skipDuplicates: true,
          })
          insertedRows += result.count
        }

        await tx.inventoryUpload.update({ where: { id: upload.id }, data: { insertedRows } })

        return { uploadId: upload.id, insertedRows }
      },
      { maxWait: 10_000, timeout: 120_000 }
    )

    return {
      success: true,
      uploadId: saved.uploadId,
      fileType,
      totalRows: rows.length,
      insertedRows: saved.insertedRows,
      skippedUnresolved,
      unresolvedOptionIds: unresolved,
    }
  } catch (err) {
    // 트랜잭션 롤백 — 기존 스냅샷은 그대로 보존된다
    return {
      success: false,
      error: `데이터 저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }
}
