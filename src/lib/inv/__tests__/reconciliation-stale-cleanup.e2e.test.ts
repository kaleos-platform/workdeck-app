/**
 * 로켓그로스 대조 "열린 세션 최신 1건만 유지" e2e.
 *
 * 대조 확정은 절대량 set 이라, 며칠 지난 스냅샷을 뒤늦게 확정하면 그 사이 입출고가
 * 옛 실재고로 덮어써진다. 낡은 미확정 대조는 목록을 어지럽히는 문제가 아니라
 * 재고 손상 경로다.
 *
 * 검증:
 *   1. 낡은 PENDING 여러 건이 CANCELLED 로 정리되고 최신 1건만 남는다.
 *   2. PARTIAL(일부 적용됨)도 정리되지만 InvMovement/InvStockLevel 은 불변.
 *   3. keep 보다 나중 스냅샷은 절대 취소되지 않는다(최신 마커 가드).
 *   4. 같은 날짜 세션은 죽지 않는다(strict <) — 그날 올린 수동 업로드 보호.
 *   5. CONFIRMED/APPLIED/CANCELLED 는 건드리지 않는다.
 *   6. externalSource 가 없는 일반 위치는 무영향.
 *
 * throwaway Space/User, afterAll cascade 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { cancelSupersededRocketGrowthReconciliations } from '../reconciliation-core'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '../external-sources'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000d1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000d2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let rgLocationId = ''
let ownLocationId = ''
let optionId = ''

async function cleanup() {
  await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invReconciliation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

async function makeRecon(opts: {
  locationId: string
  day: string
  status: 'PENDING' | 'PARTIAL' | 'CONFIRMED' | 'APPLIED' | 'CANCELLED'
  fileName?: string
  adjustedItems?: number
}) {
  const r = await prisma.invReconciliation.create({
    data: {
      spaceId: SPACE_ID,
      locationId: opts.locationId,
      fileName: opts.fileName ?? `쿠팡 로켓그로스 재고 (자동 ${opts.day})`,
      snapshotDate: new Date(`${opts.day}T00:00:00.000Z`),
      status: opts.status,
      matchResults: [],
      totalItems: 0,
      matchedItems: 0,
      adjustedItems: opts.adjustedItems ?? 0,
    },
  })
  return r.id
}

async function statusOf(id: string) {
  return (await prisma.invReconciliation.findUnique({ where: { id }, select: { status: true } }))
    ?.status
}

d('로켓그로스 낡은 대조 정리 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E ReconStaleCleanup', type: 'PERSONAL' },
    })
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-recon-stale@throwaway.test' } })

    rgLocationId = (
      await prisma.invStorageLocation.create({
        data: {
          spaceId: SPACE_ID,
          name: 'E2E 쿠팡 로켓그로스',
          type: 'THIRD_PARTY',
          isActive: true,
          externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
        },
      })
    ).id
    ownLocationId = (
      await prisma.invStorageLocation.create({
        data: { spaceId: SPACE_ID, name: 'E2E 자사창고', type: 'OWN', isActive: true },
      })
    ).id

    const group = await prisma.invProductGroup.create({ data: { spaceId: SPACE_ID, name: '기본' } })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 상품', groupId: group.id, status: 'ACTIVE' },
    })
    optionId = (
      await prisma.invProductOption.create({ data: { productId: product.id, name: '기본' } })
    ).id
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.invReconciliation.deleteMany({ where: { spaceId: SPACE_ID } })
  })

  it('1) 낡은 PENDING 은 전부 CANCELLED, 최신 1건만 남는다', async () => {
    const olds = []
    for (const day of ['2026-08-24', '2026-08-27', '2026-09-01', '2026-09-02', '2026-09-03']) {
      olds.push(await makeRecon({ locationId: rgLocationId, day, status: 'PENDING' }))
    }
    const keep = await makeRecon({ locationId: rgLocationId, day: '2026-09-06', status: 'PENDING' })

    const count = await cancelSupersededRocketGrowthReconciliations({
      spaceId: SPACE_ID,
      locationId: rgLocationId,
      keepId: keep,
      keepSnapshotDate: new Date('2026-09-06T00:00:00.000Z'),
    })

    expect(count).toBe(5)
    for (const id of olds) expect(await statusOf(id)).toBe('CANCELLED')
    expect(await statusOf(keep)).toBe('PENDING')
  })

  it('2) PARTIAL 도 정리되지만 재고·원장은 불변', async () => {
    await prisma.invStockLevel.create({
      data: { spaceId: SPACE_ID, optionId, locationId: rgLocationId, quantity: 42 },
    })
    const partial = await makeRecon({
      locationId: rgLocationId,
      day: '2026-09-01',
      status: 'PARTIAL',
      adjustedItems: 3,
    })
    await prisma.invMovement.create({
      data: {
        spaceId: SPACE_ID,
        optionId,
        locationId: rgLocationId,
        type: 'ADJUSTMENT',
        quantity: 5,
        reason: 'e2e',
        referenceId: partial,
        movementDate: new Date('2026-09-01'),
      },
    })
    const keep = await makeRecon({ locationId: rgLocationId, day: '2026-09-06', status: 'PENDING' })

    await cancelSupersededRocketGrowthReconciliations({
      spaceId: SPACE_ID,
      locationId: rgLocationId,
      keepId: keep,
      keepSnapshotDate: new Date('2026-09-06T00:00:00.000Z'),
    })

    expect(await statusOf(partial)).toBe('CANCELLED')
    expect(
      await prisma.invMovement.count({ where: { referenceId: partial, type: 'ADJUSTMENT' } })
    ).toBe(1)
    expect(
      (
        await prisma.invStockLevel.findUnique({
          where: { optionId_locationId: { optionId, locationId: rgLocationId } },
        })
      )?.quantity
    ).toBe(42)
  })

  it('3) keep 보다 나중 스냅샷은 취소되지 않는다', async () => {
    const future = await makeRecon({
      locationId: rgLocationId,
      day: '2026-09-10',
      status: 'PENDING',
    })
    const keep = await makeRecon({ locationId: rgLocationId, day: '2026-09-06', status: 'PENDING' })

    await cancelSupersededRocketGrowthReconciliations({
      spaceId: SPACE_ID,
      locationId: rgLocationId,
      keepId: keep,
      keepSnapshotDate: new Date('2026-09-06T00:00:00.000Z'),
    })

    expect(await statusOf(future)).toBe('PENDING')
  })

  it('4) 같은 날짜의 수동 업로드 세션은 살아남는다', async () => {
    const manual = await makeRecon({
      locationId: rgLocationId,
      day: '2026-09-06',
      status: 'PENDING',
      fileName: '재고조정_수기.xlsx',
    })
    const keep = await makeRecon({ locationId: rgLocationId, day: '2026-09-06', status: 'PENDING' })

    const count = await cancelSupersededRocketGrowthReconciliations({
      spaceId: SPACE_ID,
      locationId: rgLocationId,
      keepId: keep,
      keepSnapshotDate: new Date('2026-09-06T00:00:00.000Z'),
    })

    expect(count).toBe(0)
    expect(await statusOf(manual)).toBe('PENDING')
  })

  it('5) CONFIRMED/APPLIED/CANCELLED 는 건드리지 않는다', async () => {
    const confirmed = await makeRecon({
      locationId: rgLocationId,
      day: '2026-08-30',
      status: 'CONFIRMED',
    })
    const applied = await makeRecon({
      locationId: rgLocationId,
      day: '2026-08-31',
      status: 'APPLIED',
    })
    const cancelled = await makeRecon({
      locationId: rgLocationId,
      day: '2026-09-01',
      status: 'CANCELLED',
    })
    const keep = await makeRecon({ locationId: rgLocationId, day: '2026-09-06', status: 'PENDING' })

    const count = await cancelSupersededRocketGrowthReconciliations({
      spaceId: SPACE_ID,
      locationId: rgLocationId,
      keepId: keep,
      keepSnapshotDate: new Date('2026-09-06T00:00:00.000Z'),
    })

    expect(count).toBe(0)
    expect(await statusOf(confirmed)).toBe('CONFIRMED')
    expect(await statusOf(applied)).toBe('APPLIED')
    expect(await statusOf(cancelled)).toBe('CANCELLED')
  })

  it('6) 로켓그로스가 아닌 일반 위치는 무영향', async () => {
    const old = await makeRecon({
      locationId: ownLocationId,
      day: '2026-08-24',
      status: 'PENDING',
      fileName: '재고조정_3PL.xlsx',
    })
    const keep = await makeRecon({
      locationId: ownLocationId,
      day: '2026-09-06',
      status: 'PENDING',
      fileName: '재고조정_3PL2.xlsx',
    })

    const count = await cancelSupersededRocketGrowthReconciliations({
      spaceId: SPACE_ID,
      locationId: ownLocationId,
      keepId: keep,
      keepSnapshotDate: new Date('2026-09-06T00:00:00.000Z'),
    })

    expect(count).toBe(0)
    expect(await statusOf(old)).toBe('PENDING')
  })
})
