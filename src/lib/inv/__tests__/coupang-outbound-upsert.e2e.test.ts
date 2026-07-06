/**
 * upsertOutboundMovement — 멱등·정정·동시성(advisory lock) e2e.
 *
 * 감사 High #5: InvMovement.referenceId에 유니크 제약이 없어 cron 겹침·수동 트리거 중복 시
 * 동일 referenceId로 OUTBOUND 2건이 생성돼 재고가 이중 차감될 수 있다.
 * → pg_advisory_xact_lock(hashtext(referenceId))으로 트랜잭션 단위 직렬화.
 *
 * throwaway Space/User 시드 → lib 함수 직접 호출(route mock 불필요) → afterAll cascade 복원.
 * DB URL 없으면 전체 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { upsertOutboundMovement } from '@/lib/inv/coupang-sales-to-movement'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000f2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let optionId = ''
let locationId = ''
let channelId = ''

const MOVE_DATE = new Date('2026-07-01T00:00:00+09:00')

async function cleanup() {
  // cascade: Space 삭제 시 연결 모델 전부 제거됨.
  // 단, InvMovement·InvStockLevel은 Cascade이므로 Space 삭제만으로 충분하나
  // 순서 보장을 위해 명시적으로 선삭제.
  await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.channel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

d('upsertOutboundMovement — 멱등·정정·advisory lock 동시성 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    // Space/User 시드
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E OutboundUpsert', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-outbound-upsert@throwaway.test' },
    })

    // 상품 계층 시드
    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본' },
    })
    const product = await prisma.invProduct.create({
      data: {
        spaceId: SPACE_ID,
        name: 'E2E 출고상품',
        groupId: group.id,
        status: 'ACTIVE',
      },
    })
    const option = await prisma.invProductOption.create({
      data: { productId: product.id, name: 'A' },
    })
    optionId = option.id

    // 재고 위치 시드
    const location = await prisma.invStorageLocation.create({
      data: { spaceId: SPACE_ID, name: 'E2E 창고', type: 'OWN', isActive: true },
    })
    locationId = location.id

    // 판매 채널 시드
    const channel = await prisma.channel.create({
      data: { spaceId: SPACE_ID, name: 'E2E 채널' },
    })
    channelId = channel.id
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  // 각 테스트 전 이동·재고 초기화 (테스트 독립성)
  beforeEach(async () => {
    await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  })

  test('테스트 1 — 멱등: 같은 referenceId 2회 호출 → created 후 skipped, OUTBOUND 1건, 재고 -5', async () => {
    const refId = 'e2e-test:2026-07-01:opt-a'

    const r1 = await upsertOutboundMovement({
      spaceId: SPACE_ID,
      optionId,
      locationId,
      channelId,
      quantity: 5,
      movementDate: MOVE_DATE,
      referenceId: refId,
    })
    expect(r1).toBe('created')

    const r2 = await upsertOutboundMovement({
      spaceId: SPACE_ID,
      optionId,
      locationId,
      channelId,
      quantity: 5,
      movementDate: MOVE_DATE,
      referenceId: refId,
    })
    expect(r2).toBe('skipped')

    // OUTBOUND 1건만 존재
    const movements = await prisma.invMovement.findMany({
      where: { spaceId: SPACE_ID, type: 'OUTBOUND', referenceId: refId },
    })
    expect(movements).toHaveLength(1)
    expect(movements[0].quantity).toBe(5)

    // 재고 -5 (1회만 차감)
    const stock = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId, locationId } },
    })
    expect(stock?.quantity).toBe(-5)
  })

  test('테스트 2 — 정정: 수량 5→8 재호출 → updated, 이동 1건에 quantity 8, 재고 -8', async () => {
    const refId = 'e2e-test:2026-07-01:opt-b'

    await upsertOutboundMovement({
      spaceId: SPACE_ID,
      optionId,
      locationId,
      channelId,
      quantity: 5,
      movementDate: MOVE_DATE,
      referenceId: refId,
    })

    const r2 = await upsertOutboundMovement({
      spaceId: SPACE_ID,
      optionId,
      locationId,
      channelId,
      quantity: 8,
      movementDate: MOVE_DATE,
      referenceId: refId,
    })
    expect(r2).toBe('updated')

    // 이동은 여전히 1건, 수량 8
    const movements = await prisma.invMovement.findMany({
      where: { spaceId: SPACE_ID, type: 'OUTBOUND', referenceId: refId },
    })
    expect(movements).toHaveLength(1)
    expect(movements[0].quantity).toBe(8)

    // 재고 -8 (델타 -3 추가 적용: -5 → -8)
    const stock = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId, locationId } },
    })
    expect(stock?.quantity).toBe(-8)
  })

  test('테스트 3 — 동시성: 같은 referenceId 2개 동시 upsert → OUTBOUND 1건·재고 -5 (advisory lock 직렬화)', async () => {
    const refId = 'e2e-test:2026-07-01:opt-c'

    // 두 호출을 동시에 시작 — advisory lock 없으면 둘 다 existing=null을 보고 2건 생성 위험.
    await Promise.all([
      upsertOutboundMovement({
        spaceId: SPACE_ID,
        optionId,
        locationId,
        channelId,
        quantity: 5,
        movementDate: MOVE_DATE,
        referenceId: refId,
      }),
      upsertOutboundMovement({
        spaceId: SPACE_ID,
        optionId,
        locationId,
        channelId,
        quantity: 5,
        movementDate: MOVE_DATE,
        referenceId: refId,
      }),
    ])

    // advisory lock으로 직렬화되어 OUTBOUND는 1건만 생성
    const movements = await prisma.invMovement.findMany({
      where: { spaceId: SPACE_ID, type: 'OUTBOUND', referenceId: refId },
    })
    expect(movements).toHaveLength(1)
    expect(movements[0].quantity).toBe(5)

    // 재고 -5 (이중 차감 없음)
    const stock = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId, locationId } },
    })
    expect(stock?.quantity).toBe(-5)
  })
})
