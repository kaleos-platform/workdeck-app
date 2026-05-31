/**
 * 배송 이력(📀 데이터 저장) → DelBatch(source=IMPORT)/DelOrder + InvMovement OUTBOUND 1회성 이전.
 *
 * 실행:
 *   npx tsx scripts/import-delivery-history.ts --file docs/source_ref/delivery_history.xlsx --preview
 *   npx tsx scripts/import-delivery-history.ts --file docs/source_ref/delivery_history.xlsx --space <spaceId>
 *
 * 옵션:
 *   --file <path>     엑셀 경로 (필수)
 *   --space <id>      대상 spaceId (생략 시 space 1개뿐이면 자동 선택, 여러 개면 에러)
 *   --location <id>   출고 보관장소 (생략 시 첫 활성 WAREHOUSE)
 *   --preview         DB 미변경, 통계 + 미등록 목록만 출력
 *
 * 원칙:
 * - 재고(InvStockLevel) 차감 안 함. InvMovement OUTBOUND만 직접 createMany.
 * - 완전한 주문만 import. 채널/상품 미등록 → 보류 + 리포트.
 * - 멱등: content hash. 기존 referenceId(import:dh:<hash>) 있으면 skip.
 * - PII 암호화. ENCRYPTION_KEY 필요(실제 실행 시).
 */

import { readFileSync } from 'node:fs'
import { config } from 'dotenv'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { encryptOrderPii } from '../src/lib/del/encryption'
import {
  parseDeliveryHistory,
  resolveRows,
  buildAliasByChannel,
  normalizeChannel,
  type ChannelLookup,
  type ListingItemsMap,
} from '../src/lib/sh/delivery-history-import'

config({ path: '.env.local' })

// ─── 인자 파싱 ──────────────────────────────────────────────────────────────
function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const FILE = getArg('file')
const SPACE_ARG = getArg('space')
const LOCATION_ARG = getArg('location')
const PREVIEW = process.argv.includes('--preview')

if (!FILE) {
  console.error('❌ --file <엑셀경로> 가 필요합니다')
  process.exit(1)
}

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) {
  console.error('❌ DIRECT_URL 또는 DATABASE_URL 환경변수가 필요합니다')
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString, max: 5 })
const prisma = new PrismaClient({ adapter })

const REF_PREFIX = 'import:dh:'
const IMPORT_REASON = '[이전 데이터] 재고 미반영'

async function main() {
  // 1) space 결정
  let spaceId = SPACE_ARG
  if (!spaceId) {
    const spaces = await prisma.space.findMany({ select: { id: true, name: true } })
    if (spaces.length === 1) {
      spaceId = spaces[0].id
      console.log(`ℹ️  space 자동 선택: ${spaces[0].name} (${spaceId})`)
    } else {
      console.error(`❌ space가 ${spaces.length}개입니다. --space <id>로 지정하세요:`)
      spaces.forEach((s) => console.error(`   ${s.id}  ${s.name}`))
      process.exit(1)
    }
  }

  // 2) 출고 보관장소 결정 — 실제 삽입 시에만 필수. preview는 매핑만 보므로 건너뜀.
  let locationId = LOCATION_ARG
  if (!locationId && !PREVIEW) {
    const loc = await prisma.invStorageLocation.findFirst({
      where: { spaceId, isActive: true, type: 'OWN' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    })
    if (!loc) {
      console.error('❌ 활성 보관장소(자가창고 OWN)가 없습니다. --location <id>로 지정하세요')
      process.exit(1)
    }
    locationId = loc.id
    console.log(`ℹ️  출고 보관장소: ${loc.name} (${locationId})`)
  }

  // 3) 파싱
  const buffer = readFileSync(FILE!)
  const parsed = parseDeliveryHistory(buffer)
  console.log(
    `\n📄 파싱: 주문후보 ${parsed.rows.length} · 빈행 ${parsed.emptyRows} · 제외채널 ${parsed.excludedChannelRows}`
  )

  // 4) lookup 구성 — 채널, 별칭, listing 구성
  const channels = await prisma.channel.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true },
  })
  const channelLookup: ChannelLookup = new Map(
    channels.map((c) => [normalizeChannel(c.name), c.id])
  )

  // 별칭은 전 채널 조회 (행에서 쓰는 채널만 추리면 좋지만 단발이므로 전체)
  const aliasRows = await prisma.channelProductAlias.findMany({
    where: { spaceId },
    select: {
      channelId: true,
      aliasName: true,
      optionId: true,
      listingId: true,
      fulfillments: { select: { optionId: true, quantity: true } },
    },
  })
  const aliasByChannel = buildAliasByChannel(
    aliasRows.map((r) => ({
      channelId: r.channelId,
      aliasName: r.aliasName,
      optionId: r.optionId,
      listingId: r.listingId,
      fulfillments: r.fulfillments.length > 0 ? r.fulfillments : null,
    }))
  )

  // listing 구성 옵션
  const listingIds = Array.from(
    new Set(aliasRows.map((r) => r.listingId).filter((v): v is string => !!v))
  )
  const listingItems: ListingItemsMap = new Map()
  if (listingIds.length > 0) {
    const listings = await prisma.productListing.findMany({
      where: { id: { in: listingIds }, spaceId },
      include: { items: { select: { optionId: true, quantity: true } } },
    })
    for (const l of listings) listingItems.set(l.id, l.items)
  }

  // 5) 매핑·검증
  const resolved = resolveRows(parsed.rows, {
    channels: channelLookup,
    aliasByChannel,
    listingItems,
  })

  console.log(
    `\n✅ 매핑 성공(삽입 후보): ${resolved.ready.length} · 범위밖 날짜: ${resolved.outOfRangeRows}`
  )
  reportMap('⚠️  미등록 채널 (먼저 채널을 생성하세요)', resolved.unmappedChannels)
  reportMap('⚠️  미등록 상품 (먼저 상품/별칭을 등록하세요)', resolved.unmappedProducts)

  // 6) 멱등 — 기존 referenceId 조회
  const hashes = resolved.ready.map((o) => REF_PREFIX + o.hash)
  const existing = await prisma.invMovement.findMany({
    where: { spaceId, referenceId: { in: hashes } },
    select: { referenceId: true },
  })
  const seen = new Set(existing.map((m) => m.referenceId))
  const fresh = resolved.ready.filter((o) => !seen.has(REF_PREFIX + o.hash))
  const skippedDuplicate = resolved.ready.length - fresh.length
  console.log(`\n🔁 신규: ${fresh.length} · 중복 skip: ${skippedDuplicate}`)

  if (PREVIEW) {
    console.log('\n🔍 PREVIEW 모드 — DB 변경 없음.')
    await prisma.$disconnect()
    return
  }

  if (fresh.length === 0) {
    console.log('\n변경할 신규 주문이 없습니다.')
    await prisma.$disconnect()
    return
  }

  // 7) 삽입 — InvImportHistory → DelBatch(IMPORT) → DelOrder(+items) → InvMovement OUTBOUND
  const fileName = FILE!.split('/').pop() ?? FILE!
  let created = 0

  await prisma.$transaction(
    async (tx) => {
      const history = await tx.invImportHistory.create({
        data: {
          spaceId,
          fileName,
          fileType: 'EXCEL',
          totalRows: parsed.rows.length,
          successRows: fresh.length,
          errorRows: 0,
        },
        select: { id: true },
      })

      const batch = await tx.delBatch.create({
        data: {
          spaceId,
          status: 'COMPLETED',
          source: 'IMPORT',
          label: `[이전] ${fileName}`,
          completedAt: new Date(),
        },
        select: { id: true },
      })

      for (const order of fresh) {
        const pii = encryptOrderPii({
          recipientName: order.row.recipientName,
          phone: order.row.phone,
          address: order.row.address,
        })
        const delOrder = await tx.delOrder.create({
          data: {
            spaceId,
            batchId: batch.id,
            channelId: order.channelId,
            ...pii,
            deliveryMessage: order.row.deliveryMessage,
            orderDate: order.orderDate,
            paymentAmount: order.paymentAmount, // 문자열 → Prisma Decimal
          },
          select: { id: true },
        })
        for (const it of order.orderItems) {
          const item = await tx.delOrderItem.create({
            data: {
              orderId: delOrder.id,
              name: it.name,
              quantity: it.quantity,
              optionId: it.optionId,
              listingId: it.listingId,
            },
            select: { id: true },
          })
          if (it.fulfillments.length > 0) {
            await tx.delOrderItemFulfillment.createMany({
              data: it.fulfillments.map((f) => ({
                orderItemId: item.id,
                optionId: f.optionId,
                quantity: f.quantity,
              })),
            })
          }
        }

        // InvMovement OUTBOUND — 재고 차감 없음. movementDate=orderDate.
        if (order.movements.length > 0) {
          await tx.invMovement.createMany({
            data: order.movements.map((m) => ({
              spaceId,
              optionId: m.optionId,
              locationId: locationId!,
              channelId: order.channelId,
              type: 'OUTBOUND' as const,
              quantity: m.quantity,
              movementDate: order.orderDate,
              orderDate: order.orderDate,
              reason: IMPORT_REASON,
              referenceId: REF_PREFIX + order.hash,
              importHistoryId: history.id,
            })),
          })
        }
        created++
      }
    },
    { timeout: 120_000 }
  )

  console.log(`\n🎉 완료: ${created}건 주문 import (재고 미차감).`)
  await prisma.$disconnect()
}

function reportMap(title: string, m: Map<string, number>) {
  if (m.size === 0) return
  console.log(`\n${title} — ${m.size}종`)
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1])
  for (const [k, v] of sorted) console.log(`   ${v.toString().padStart(4)}  ${k}`)
}

main().catch((err) => {
  console.error('❌ 실패:', err)
  prisma.$disconnect()
  process.exit(1)
})
