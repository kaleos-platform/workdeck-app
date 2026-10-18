// 브랜드별 콘텐츠 프로필. 브랜드 원본은 seller-hub `Brand` 테이블이고, brandId = null 은 Space 공통 프로필이다.

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'

type BrandProfileFields = Omit<
  Prisma.BrandProfileUncheckedCreateInput,
  'id' | 'spaceId' | 'brandId'
>

/**
 * 프로필 1건 저장. 브랜드 프로필은 (spaceId, brandId) unique 로 upsert 하지만,
 * 공통 프로필은 Postgres 가 NULL 을 서로 다른 값으로 보므로 unique 가 걸리지 않는다 →
 * advisory lock 으로 동시 생성을 막고 기존 행을 갱신한다.
 */
export async function saveBrandProfile(
  tx: Prisma.TransactionClient,
  spaceId: string,
  brandId: string | null,
  data: Partial<BrandProfileFields>
) {
  const create = { companyName: '', ...data }
  if (brandId) {
    return tx.brandProfile.upsert({
      where: { spaceId_brandId: { spaceId, brandId } },
      create: { spaceId, brandId, ...create },
      update: data,
    })
  }
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`brand-profile:${spaceId}`}))`
  const existing = await tx.brandProfile.findFirst({
    where: { spaceId, brandId: null },
    select: { id: true },
  })
  if (existing) return tx.brandProfile.update({ where: { id: existing.id }, data })
  return tx.brandProfile.create({ data: { spaceId, brandId: null, ...create } })
}

/** 트랜잭션 밖에서 저장할 때. 공통 프로필 잠금이 트랜잭션 범위라 감싸서 호출한다. */
export function saveBrandProfileNow(
  spaceId: string,
  brandId: string | null,
  data: Partial<BrandProfileFields>
) {
  return prisma.$transaction((tx) => saveBrandProfile(tx, spaceId, brandId, data))
}

/**
 * 생성 프롬프트용 프로필. 상품 브랜드 프로필이 있으면 그것, 없으면 공통 프로필.
 * ponytail: 상품이 여러 브랜드에 걸치면 브랜드가 지정된 첫 상품을 따른다. 브랜드 혼합 아이데이션이 실제로 생기면 규칙을 정한다.
 */
export async function findBrandProfileForProducts<S extends Prisma.BrandProfileSelect>(
  spaceId: string,
  productIds: string[],
  select: S
) {
  const product = productIds.length
    ? await prisma.product.findFirst({
        where: { spaceId, id: { in: productIds }, brandId: { not: null } },
        select: { brandId: true },
      })
    : null
  const brandId = product?.brandId ?? null
  return prisma.brandProfile.findFirst({
    where: brandId ? { spaceId, OR: [{ brandId }, { brandId: null }] } : { spaceId, brandId: null },
    orderBy: { brandId: { sort: 'asc', nulls: 'last' } },
    select,
  })
}

/** 클라이언트가 보낸 brandId 가 이 Space 의 브랜드인지 확인. 다른 Space 브랜드로 쓰기 방지. */
export async function isSpaceBrand(spaceId: string, brandId: string): Promise<boolean> {
  const brand = await prisma.brand.findFirst({
    where: { id: brandId, spaceId },
    select: { id: true },
  })
  return brand != null
}
