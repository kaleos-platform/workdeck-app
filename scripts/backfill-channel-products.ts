/**
 * ChannelProduct 백필 스크립트
 *
 * 기존 ProductListing 행들을 computeListingGroupKey 로직으로 그룹핑하여
 * ChannelProduct 실체 행을 생성하고 channelProductId FK를 채운다.
 *
 * 실행:
 *   npx ts-node --project tsconfig.json scripts/backfill-channel-products.ts
 *   또는:
 *   npx tsx scripts/backfill-channel-products.ts
 */

import { config } from 'dotenv'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

config({ path: '.env.local' })

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL 또는 DATABASE_URL 환경변수가 필요합니다')

const adapter = new PrismaPg({ connectionString, max: 5 })
const prisma = new PrismaClient({ adapter })

// group-key.ts 로직을 그대로 복사 (import 경로 문제 회피)
type ProductAttrDef = { name: string; values?: Array<{ value: string }> }

function collectKnownValues(
  items: Array<Record<string, string>>,
  productAttrs: Array<ProductAttrDef>
): Set<string> {
  const set = new Set<string>()
  for (const it of items) {
    for (const v of Object.values(it)) {
      if (v) set.add(v)
    }
  }
  for (const a of productAttrs) {
    for (const v of a.values ?? []) {
      if (v.value) set.add(v.value)
    }
  }
  return set
}

function stripSuffix(value: string | null, knownValues: Set<string>): string {
  if (!value) return ''
  let v = value
  v = v.replace(/\s+#\d+\s.*$/, '')
  v = v.replace(/\s+\d+개$/, '')
  let changed = true
  while (changed) {
    changed = false
    for (const known of knownValues) {
      if (!known) continue
      if (v === known) {
        v = ''
        changed = true
        break
      }
      if (v.endsWith(' ' + known)) {
        v = v.slice(0, v.length - known.length - 1).trimEnd()
        changed = true
        break
      }
    }
  }
  return v
}

function computeListingGroupKey(params: {
  managementName: string | null
  searchName: string | null
  itemAttributeValues: Array<Record<string, string>>
  productAttrs: Array<ProductAttrDef>
  listingId: string
}): string {
  const { managementName, searchName, itemAttributeValues, productAttrs, listingId } = params
  const knownValues = collectKnownValues(itemAttributeValues, productAttrs)
  return (
    stripSuffix(managementName, knownValues) ||
    stripSuffix(searchName, knownValues) ||
    `__listing_${listingId}`
  )
}

async function main() {
  console.log('=== ChannelProduct 백필 시작 ===\n')

  // 1. channelProductId 없는 listing만 대상
  const listings = await prisma.productListing.findMany({
    where: { channelProductId: null },
    include: {
      items: {
        include: {
          option: {
            select: {
              productId: true,
              attributeValues: true,
            },
          },
        },
      },
      channel: {
        select: {
          id: true,
          channelTypeDef: { select: { isSalesChannel: true } },
        },
      },
    },
  })

  console.log(`대상 listing: ${listings.length}개`)

  // 2. 판매채널 listing만 필터 + 단일 product listing만 그룹 대상
  const salesListings = listings.filter((l) => l.channel.channelTypeDef?.isSalesChannel === true)
  console.log(`판매채널 listing: ${salesListings.length}개`)

  // 3. 각 listing의 productId 집합 계산 (solo: 단일, mixed: 다중)
  //    mixed는 solo와 달리 명확한 product 귀속이 없으므로 그룹핑 스킵
  const soloListings = salesListings.filter((l) => {
    const productIds = new Set(l.items.map((it) => it.option.productId))
    return productIds.size === 1
  })
  const mixedCount = salesListings.length - soloListings.length
  console.log(
    `단일상품 listing: ${soloListings.length}개, 혼합상품 listing: ${mixedCount}개 (스킵)\n`
  )

  // 4. product별 optionAttributes 배치 조회
  const productIds = Array.from(new Set(soloListings.map((l) => l.items[0].option.productId)))
  const products = await prisma.invProduct.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      optionAttributes: true,
    },
  })
  const productAttrsMap = new Map(
    products.map((p) => [
      p.id,
      Array.isArray(p.optionAttributes) ? (p.optionAttributes as Array<ProductAttrDef>) : [],
    ])
  )

  // 5. ProductChannelGroupMeta는 드롭됨 — keywords는 빈 배열로 초기화
  const metaKeywordsMap = new Map<string, string[]>()

  // 6. (spaceId, productId, channelId, groupKey) 기준으로 그룹핑
  type GroupKey = string
  type ListingGroup = {
    spaceId: string
    productId: string
    channelId: string
    listingIds: string[]
    baseSearchName: string
    baseManagementName: string | null
  }

  const groupMap = new Map<GroupKey, ListingGroup>()

  for (const l of soloListings) {
    const productId = l.items[0].option.productId
    const productAttrs = productAttrsMap.get(productId) ?? []
    const itemAttributeValues = l.items.map(
      (it) => (it.option.attributeValues ?? {}) as Record<string, string>
    )
    const gKey = computeListingGroupKey({
      managementName: l.managementName,
      searchName: l.searchName,
      itemAttributeValues,
      productAttrs,
      listingId: l.id,
    })
    const mapKey = `${l.spaceId}:${productId}:${l.channelId}:${gKey}`
    if (!groupMap.has(mapKey)) {
      groupMap.set(mapKey, {
        spaceId: l.spaceId,
        productId,
        channelId: l.channelId,
        listingIds: [],
        baseSearchName: gKey.startsWith('__listing_') ? l.searchName : gKey,
        baseManagementName: l.managementName ? gKey : null,
      })
    }
    groupMap.get(mapKey)!.listingIds.push(l.id)
  }

  console.log(`그룹 수: ${groupMap.size}개\n`)

  // 7. 트랜잭션으로 ChannelProduct 생성 + listing FK 업데이트
  let created = 0
  let updated = 0
  let errors = 0

  for (const group of groupMap.values()) {
    try {
      await prisma.$transaction(async (tx) => {
        const keywords = metaKeywordsMap.get(`${group.productId}:${group.channelId}`) ?? []

        const cp = await tx.channelProduct.create({
          data: {
            spaceId: group.spaceId,
            channelId: group.channelId,
            productId: group.productId,
            baseSearchName: group.baseSearchName,
            baseManagementName: group.baseManagementName,
            keywords,
          },
        })
        created++

        await tx.productListing.updateMany({
          where: { id: { in: group.listingIds } },
          data: { channelProductId: cp.id },
        })
        updated += group.listingIds.length
      })
    } catch (err) {
      console.error(`그룹 처리 실패 [${group.spaceId}:${group.productId}:${group.channelId}]:`, err)
      errors++
    }
  }

  console.log(`=== 백필 완료 ===`)
  console.log(`ChannelProduct 생성: ${created}개`)
  console.log(`ProductListing 업데이트: ${updated}개`)
  if (errors > 0) console.log(`오류: ${errors}개`)

  // 8. 검증
  const remaining = await prisma.productListing.count({
    where: {
      channelProductId: null,
      channel: { channelTypeDef: { isSalesChannel: true } },
      items: { some: {} },
    },
  })
  console.log(`\n검증: channelProductId null 인 판매채널 listing (아이템 있음): ${remaining}개`)
  if (remaining > 0) {
    console.log('  → mixed 상품 또는 solo이나 그룹키 계산 실패 케이스일 수 있음')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
