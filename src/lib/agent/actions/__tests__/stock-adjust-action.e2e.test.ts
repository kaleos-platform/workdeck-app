/**
 * seller-hub.stock.adjust 승인 액션 e2e — 실 dev DB, 전용 Space 픽스처.
 */
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '../create'
import { approveAndExecute } from '../execute'
import { isExternalParams } from '../decision-policy'
import { getActionDefinition } from '../registry'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000a1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000a2'
const OTHER_SPACE_ID = 'e2e00000-0000-4000-8000-0000000000a3'
const TYPE = 'seller-hub.stock.adjust'

d('seller-hub.stock.adjust', () => {
  let locId: string
  let extLocId: string
  let syncLocId: string
  let opt: string[] = []
  let productId: string
  let otherOpt: string

  // 서버 도구와 같이 현재 재고를 읽어 expectedBefore/UpdatedAt 을 채운다.
  async function params(optionId: string, quantity: number, locationId = locId) {
    const row = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId, locationId } },
    })
    return {
      locationId,
      items: [
        {
          optionId,
          quantity,
          expectedBefore: row?.quantity ?? 0,
          expectedUpdatedAt: row?.updatedAt.toISOString() ?? null,
        },
      ],
      reason: 'e2e 실사',
    }
  }

  const propose = (p: Record<string, unknown>) =>
    createPendingAction({
      spaceId: SPACE_ID,
      actionType: TYPE,
      params: p,
      summary: 'e2e 재고 조정',
      source: 'MCP',
      actor: { type: 'agent', id: 'ag-e2e' },
    })

  const stock = async (optionId: string) =>
    (
      await prisma.invStockLevel.findUnique({
        where: { optionId_locationId: { optionId, locationId: locId } },
      })
    )?.quantity

  async function cleanup() {
    await prisma.agentPendingAction.deleteMany({
      where: { spaceId: { in: [SPACE_ID, OTHER_SPACE_ID] } },
    })
    // 상품·옵션·위치·재고·이동은 Space cascade
    await prisma.spaceMember.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: { in: [SPACE_ID, OTHER_SPACE_ID] } } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
  }

  beforeAll(async () => {
    await cleanup()
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-stock-adjust@throwaway.test', name: 'E2E Stock' },
    })
    await prisma.space.create({ data: { id: SPACE_ID, name: 'E2E Stock', type: 'PERSONAL' } })
    await prisma.space.create({
      data: { id: OTHER_SPACE_ID, name: 'E2E Stock 2', type: 'PERSONAL' },
    })
    await prisma.spaceMember.create({ data: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' } })
    const group = await prisma.invProductGroup.create({ data: { spaceId: SPACE_ID, name: 'g' } })
    const product = await prisma.invProduct.create({
      data: {
        spaceId: SPACE_ID,
        name: 'E2E 상품',
        groupId: group.id,
        status: 'ACTIVE',
        options: {
          create: [1, 2, 3, 4, 5, 6].map((n) => ({ name: `옵션${n}`, sku: `E2E-SKU-${n}` })),
        },
      },
      include: { options: { orderBy: { name: 'asc' } } },
    })
    productId = product.id
    opt = product.options.map((o) => o.id)
    const og = await prisma.invProductGroup.create({
      data: { spaceId: OTHER_SPACE_ID, name: 'g' },
    })
    const op = await prisma.invProduct.create({
      data: {
        spaceId: OTHER_SPACE_ID,
        name: '타 공간 상품',
        groupId: og.id,
        status: 'ACTIVE',
        options: { create: [{ name: '타옵션' }] },
      },
      include: { options: true },
    })
    otherOpt = op.options[0].id
    locId = (
      await prisma.invStorageLocation.create({ data: { spaceId: SPACE_ID, name: 'E2E 창고' } })
    ).id
    extLocId = (
      await prisma.invStorageLocation.create({
        data: { spaceId: SPACE_ID, name: 'E2E 로켓', externalSource: 'coupang_rocket_growth' },
      })
    ).id
    syncLocId = (
      await prisma.invStorageLocation.create({
        data: {
          spaceId: SPACE_ID,
          name: 'E2E 3PL',
          syncProvider: 'wekeep',
          autoReconcileWeekly: true,
        },
      })
    ).id
    // 옵션1~5 현재 재고 10
    await prisma.invStockLevel.createMany({
      data: opt.slice(0, 5).map((optionId) => ({
        spaceId: SPACE_ID,
        optionId,
        locationId: locId,
        quantity: 10,
      })),
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('외부 액션 · 웹 단건 승인 강제', () => {
    const def = getActionDefinition(TYPE)!
    expect(isExternalParams(def, {})).toBe(true)
    expect(def.requiresWebReview?.({} as never)).toBe(true)
  })

  test('제안은 승인 대기, 승인하면 재고 설정 + ADJUSTMENT 기록(referenceId=actionId)', async () => {
    const r = await propose(await params(opt[0], 7))
    expect(r.status).toBe('pending_approval')
    expect(await stock(opt[0])).toBe(10) // 승인 전엔 그대로
    const out = await approveAndExecute(r.actionId, USER_ID, { webReviewed: true })
    expect(out.status).toBe('EXECUTED')
    expect(await stock(opt[0])).toBe(7)
    const mv = await prisma.invMovement.findMany({ where: { spaceId: SPACE_ID, optionId: opt[0] } })
    expect(mv).toHaveLength(1)
    expect(mv[0]).toMatchObject({
      type: 'ADJUSTMENT',
      quantity: -3,
      referenceId: r.actionId,
      locationId: locId,
    })
    expect(mv[0].reason).toContain('(에이전트 제안 승인)')
  })

  test('재고 행이 없던 옵션도 승인 시 생성', async () => {
    const r = await propose(await params(opt[5], 4))
    const out = await approveAndExecute(r.actionId, USER_ID, { webReviewed: true })
    expect(out.status).toBe('EXECUTED')
    expect(await stock(opt[5])).toBe(4)
  })

  test('제안 후 재고가 바뀌었다가 같은 수량으로 돌아와도(updatedAt 다름) 실패 + 변경 없음', async () => {
    const r = await propose(await params(opt[1], 3))
    await prisma.invStockLevel.update({
      where: { optionId_locationId: { optionId: opt[1], locationId: locId } },
      data: { quantity: 15 },
    })
    await prisma.invStockLevel.update({
      where: { optionId_locationId: { optionId: opt[1], locationId: locId } },
      data: { quantity: 10 },
    })
    const out = await approveAndExecute(r.actionId, USER_ID, { webReviewed: true })
    expect(out.status).toBe('FAILED')
    expect(await stock(opt[1])).toBe(10)
    expect(await prisma.invMovement.count({ where: { spaceId: SPACE_ID, optionId: opt[1] } })).toBe(
      0
    )
  })

  test('다중 옵션 중 하나만 바뀌어도 전체 롤백', async () => {
    const a = await params(opt[2], 1)
    const b = await params(opt[3], 2)
    const r = await propose({ ...a, items: [...a.items, ...b.items] })
    await prisma.invStockLevel.update({
      where: { optionId_locationId: { optionId: opt[3], locationId: locId } },
      data: { quantity: 11 },
    })
    const out = await approveAndExecute(r.actionId, USER_ID, { webReviewed: true })
    expect(out.status).toBe('FAILED')
    expect(await stock(opt[2])).toBe(10)
    expect(await stock(opt[3])).toBe(11)
    expect(
      await prisma.invMovement.count({
        where: { spaceId: SPACE_ID, optionId: { in: [opt[2], opt[3]] } },
      })
    ).toBe(0)
  })

  test('자동 연동 위치(externalSource·3PL 자동 대조) 거부', async () => {
    await expect(propose(await params(opt[4], 3, extLocId))).rejects.toThrow(/자동 연동/)
    await expect(propose(await params(opt[4], 3, syncLocId))).rejects.toThrow(/자동 연동/)
  })

  test('차이 0 거부', async () => {
    await expect(propose(await params(opt[4], 10))).rejects.toThrow(/같아/)
  })

  test('다른 Space 옵션 거부', async () => {
    await expect(propose(await params(otherOpt, 3))).rejects.toThrow(/옵션을 찾을 수 없/)
  })

  test('승인 대기 중인 같은 옵션 제안이 있으면 두 번째 거부', async () => {
    await propose(await params(opt[4], 3))
    await expect(propose(await params(opt[4], 5))).rejects.toThrow(/승인 대기/)
  })

  test('제안 후 옵션이 삭제되면 승인 시 실패', async () => {
    const r = await propose(await params(opt[2], 2))
    await prisma.invProductOption.update({ where: { id: opt[2] }, data: { deletedAt: new Date() } })
    const out = await approveAndExecute(r.actionId, USER_ID, { webReviewed: true })
    expect(out.status).toBe('FAILED')
    expect(await stock(opt[2])).toBe(10)
    expect(productId).toBeTruthy()
  })
})
