/**
 * 쿠팡 판매 OUTBOUND 재고차감 QA (2026-06-06 재고모델 전환 검증).
 * 실행: node --env-file=/tmp/.env.preview ... 대신 아래로 preview DB 지정:
 *   DATABASE_URL="$(grep ^DATABASE_URL /tmp/.env.preview|cut -d= -f2-|tr -d '\"')" \
 *   npx tsx --tsconfig tsconfig.json scripts/qa-coupang-sales-decrement.ts
 *
 * 검증: 페어링(채널 자동생성+working link), 재고 차감, 멱등 skip, 정정 delta, 전체취소 복원.
 * fresh date/option 사용(과거 stock-neutral referenceId 충돌 방지). 끝에 정리.
 */
import { prisma } from '../src/lib/prisma.js'
import {
  runCoupangSalesSyncForDates,
  coupangSalesReferenceId,
} from '../src/lib/inv/coupang-sales-to-movement.js'
import {
  ensureCoupangSalesChannel,
  ensureCoupangLocation,
} from '../src/lib/inv/coupang-channel-pairing.js'
import { resolveCoupangWorkspaceForSpace } from '../src/lib/inv/resolve-coupang-workspace.js'

const SPACE_ID = '78377ae5-6614-4a40-9998-d0c392f9083b'
const WORKSPACE_ID = 'cmm98fbbp000004lbhh31p981'
const LOCATION_ID = 'cmoztcpla003c04ldkd7f00fc'
// fresh date — 과거 stock-neutral referenceId 와 충돌하지 않도록 먼 미래/특이 날짜
const QA_DATE = new Date('2099-01-15T00:00:00+09:00')
const EXT_CODE = 'QA-COUPANG-SALES-9999'

let pass = 0
let fail = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++
    console.log(`  ✅ ${label}`)
  } else {
    fail++
    console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`)
  }
}

async function stockOf(optionId: string): Promise<number> {
  const s = await prisma.invStockLevel.findUnique({
    where: { optionId_locationId: { optionId, locationId: LOCATION_ID } },
  })
  return s?.quantity ?? 0
}

async function seedVendor(salesQty: number, uploadId: string) {
  await prisma.inventoryRecord.deleteMany({
    where: { workspaceId: WORKSPACE_ID, fileType: 'VENDOR_ITEM_METRICS', optionId: EXT_CODE },
  })
  await prisma.inventoryRecord.create({
    data: {
      workspaceId: WORKSPACE_ID,
      uploadId,
      snapshotDate: QA_DATE,
      fileType: 'VENDOR_ITEM_METRICS',
      productId: EXT_CODE,
      optionId: EXT_CODE,
      skuId: EXT_CODE,
      productName: 'QA 쿠팡판매 상품',
      fulfillmentType: '로켓그로스',
      salesQty30d: salesQty,
      revenue30d: salesQty * 1000,
    },
  })
}

async function main() {
  console.log('=== 쿠팡 판매 OUTBOUND 재고차감 QA ===')

  // ── 0) 사전: 옵션 1개 확보 + 매핑 + InventoryUpload(레코드 FK) ──
  const opt = await prisma.invProductOption.findFirst({
    where: { product: { spaceId: SPACE_ID, status: 'ACTIVE' } },
    select: { id: true },
  })
  if (!opt) throw new Error('ACTIVE 옵션이 없습니다 — 시딩 불가')
  const optionId = opt.id

  const upload = await prisma.inventoryUpload.create({
    data: {
      workspaceId: WORKSPACE_ID,
      fileName: 'qa-coupang.xlsx',
      fileType: 'VENDOR_ITEM_METRICS',
      snapshotDate: QA_DATE,
    },
  })

  // 매핑 (externalCode → optionId, quantity 1)
  await prisma.invLocationProductMap.deleteMany({
    where: { locationId: LOCATION_ID, externalCode: EXT_CODE },
  })
  await prisma.invLocationProductMap.create({
    data: {
      spaceId: SPACE_ID,
      locationId: LOCATION_ID,
      externalCode: EXT_CODE,
      items: { create: [{ optionId, quantity: 1 }] },
    },
  })

  const startStock = await stockOf(optionId)
  console.log(`기준 재고(option ${optionId}): ${startStock}`)

  // ── 1) 페어링: 로켓 채널 자동생성 + working link ──
  console.log('\n[1] 채널 페어링')
  const ch = await ensureCoupangSalesChannel(SPACE_ID)
  await ensureCoupangLocation(SPACE_ID, WORKSPACE_ID)
  check('로켓 채널 생성/확보', !!ch.channelId)
  const resolved = await resolveCoupangWorkspaceForSpace(SPACE_ID)
  check(
    'working link (externalIntegrationKey 해석)',
    resolved?.workspaceId === WORKSPACE_ID,
    `resolved=${JSON.stringify(resolved)}`
  )

  // ── 2) 신규 변환: 재고 차감 ──
  console.log('\n[2] 재고 차감 (판매 10)')
  await seedVendor(10, upload.id)
  await runCoupangSalesSyncForDates([QA_DATE])
  const afterCreate = await stockOf(optionId)
  check('재고가 10 차감됨', afterCreate === startStock - 10, `${startStock} → ${afterCreate}`)
  const ref = coupangSalesReferenceId(QA_DATE, optionId)
  const mv = await prisma.invMovement.findFirst({ where: { referenceId: ref, type: 'OUTBOUND' } })
  check('OUTBOUND 이동 생성 (qty 10)', mv?.quantity === 10)

  // ── 3) 멱등: 재실행 skip ──
  console.log('\n[3] 멱등 재실행')
  await runCoupangSalesSyncForDates([QA_DATE])
  check('재고 추가 차감 없음', (await stockOf(optionId)) === startStock - 10)

  // ── 4) 정정: 판매 10→7, delta(+3 복원) ──
  console.log('\n[4] 정정 (10→7)')
  await seedVendor(7, upload.id)
  await runCoupangSalesSyncForDates([QA_DATE])
  const afterFix = await stockOf(optionId)
  check(
    '재고 delta 보정 (7 차감 상태)',
    afterFix === startStock - 7,
    `${afterFix} (기대 ${startStock - 7})`
  )

  // ── 5) 전체취소: 판매 0, 복원 + movement 삭제 ──
  console.log('\n[5] 전체취소 (7→0)')
  await seedVendor(0, upload.id)
  await runCoupangSalesSyncForDates([QA_DATE])
  const afterCancel = await stockOf(optionId)
  check('재고 전부 복원', afterCancel === startStock, `${afterCancel} (기대 ${startStock})`)
  const mvAfter = await prisma.invMovement.findFirst({
    where: { referenceId: ref, type: 'OUTBOUND' },
  })
  check('OUTBOUND 삭제됨', !mvAfter)

  // ── 정리 ──
  console.log('\n[정리]')
  await prisma.invMovement.deleteMany({ where: { referenceId: ref } })
  await prisma.invLocationProductMap.deleteMany({
    where: { locationId: LOCATION_ID, externalCode: EXT_CODE },
  })
  await prisma.inventoryRecord.deleteMany({ where: { uploadId: upload.id } })
  await prisma.inventoryUpload.delete({ where: { id: upload.id } })
  // 재고 원복(차감/복원이 startStock 으로 끝났어야 함 — 잔차 있으면 보정)
  const finalStock = await stockOf(optionId)
  if (finalStock !== startStock) {
    await prisma.invStockLevel.update({
      where: { optionId_locationId: { optionId, locationId: LOCATION_ID } },
      data: { quantity: startStock },
    })
    console.log(`  재고 원복: ${finalStock} → ${startStock}`)
  }
  // QA 채널은 페어링 검증 산물 — 남겨두면 sales-sync 가 빈 변환만 하므로 무해하나, 깨끗이 삭제.
  await prisma.channel
    .deleteMany({ where: { id: ch.channelId, externalSource: 'coupang_rocket_growth' } })
    .catch(() => {})

  console.log(`\n=== 결과: ${pass} PASS / ${fail} FAIL ===`)
  await prisma.$disconnect()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
