import { prisma } from '@/lib/prisma'
import { parseInventoryExcel } from '@/lib/inventory-parser'
import type { InventoryFileType } from '@/lib/inventory-parser'

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
}): Promise<InventoryUploadResult | InventoryUploadError> {
  const { workspaceId, fileName, buffer, snapshotDate } = params

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
    const recent = await prisma.inventoryUpload.findMany({
      where: { workspaceId, fileType: 'INVENTORY_HEALTH', insertedRows: { gt: 0 } },
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

  // 2. 업로드 레코드 생성
  const upload = await prisma.inventoryUpload.create({
    data: {
      workspaceId,
      fileName,
      fileType: parsed.fileType,
      snapshotDate,
      totalRows: parsed.rows.length,
    },
  })

  // 3. 기존 동일 스냅샷 + 동일 fileType 데이터 삭제 (덮어쓰기)
  const oldUploads = await prisma.inventoryUpload.findMany({
    where: { workspaceId, snapshotDate, fileType: parsed.fileType, id: { not: upload.id } },
    select: { id: true },
  })
  if (oldUploads.length > 0) {
    await prisma.inventoryRecord.deleteMany({
      where: { uploadId: { in: oldUploads.map((u) => u.id) } },
    })
    // 고아 업로드 레코드도 정리
    await prisma.inventoryUpload.deleteMany({
      where: { id: { in: oldUploads.map((u) => u.id) } },
    })
  }

  // 4. 벌크 삽입
  let insertedRows = 0
  try {
    for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
      const batch = parsed.rows.slice(i, i + BATCH_SIZE)
      const result = await prisma.inventoryRecord.createMany({
        data: batch.map((row) => ({
          workspaceId,
          snapshotDate,
          fileType: parsed.fileType,
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
  } catch (err) {
    // 삽입 실패 시 업로드 레코드와 부분 데이터 정리
    await prisma.inventoryRecord.deleteMany({ where: { uploadId: upload.id } }).catch(() => {})
    await prisma.inventoryUpload.delete({ where: { id: upload.id } }).catch(() => {})
    return {
      success: false,
      error: `데이터 저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  // 5. 업로드 레코드 업데이트
  await prisma.inventoryUpload.update({
    where: { id: upload.id },
    data: { insertedRows },
  })

  return {
    success: true,
    uploadId: upload.id,
    fileType: parsed.fileType,
    totalRows: parsed.rows.length,
    insertedRows,
  }
}
