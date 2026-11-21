/**
 * 실 DB(dev) — lease·커서의 조건부 쓰기가 Postgres 에서 기대대로 동작하는지.
 * 만든 데이터는 afterAll 에서 지운다.
 */
import { prisma } from '@/lib/prisma'
import { ingestLines, ingestScanLines } from '../ingest'
import {
  cleanupStaleOperations,
  finishFullScan,
  finishObserve,
  planWindows,
  startFullScan,
  startObserve,
} from '../operations'
import { reconcileChannel } from '../reconcile-run'
import { ChannelOrderError, type ObserveCursor } from '../types'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SP = 'e2e00000-0000-4000-8000-0000000c0de1'
const CH = 'e2e00000-0000-4000-8000-0000000c0de2'
const MIN = 60_000

const line = (key: string, over: Record<string, unknown> = {}) => ({
  externalLineKey: key,
  externalOrderId: `O-${key}`,
  paidAt: '2026-11-20T01:00:00.000Z',
  productName: '상품',
  quantity: 1,
  channelStatus: 'PAYED',
  deliveryKind: 'NORMAL',
  ...over,
})

const reset = async () => {
  await prisma.pipelineOperation.deleteMany({ where: { spaceId: SP } })
  await prisma.channelOrderLine.deleteMany({ where: { channelId: CH } })
  await prisma.$executeRaw`UPDATE "ChannelFulfillmentSetting" SET "observeCursor" = NULL, "observeLease" = NULL WHERE "channelId" = ${CH}`
}

const cursorOf = async () =>
  (await prisma.channelFulfillmentSetting.findUniqueOrThrow({ where: { channelId: CH } }))
    .observeCursor as ObserveCursor | null

d('채널 주문 관측 lease·커서(dev DB)', () => {
  beforeAll(async () => {
    await prisma.space.upsert({
      where: { id: SP },
      update: {},
      create: { id: SP, name: 'E2E order observe', type: 'PERSONAL' },
    })
    await prisma.channel.upsert({
      where: { id: CH },
      update: {},
      create: { id: CH, spaceId: SP, name: 'E2E 채널' },
    })
    await prisma.channelFulfillmentSetting.upsert({
      where: { channelId: CH },
      update: { observeEnabled: true, adapter: 'cafe24', reconcileMode: 'diagnose' },
      create: { channelId: CH, spaceId: SP, adapter: 'cafe24', observeEnabled: true },
    })
  })
  afterAll(async () => {
    await prisma.pipelineOperation.deleteMany({ where: { spaceId: SP } })
    await prisma.space.deleteMany({ where: { id: SP } }) // 채널·설정·행 cascade
  })
  beforeEach(reset)

  it('동시 시작은 하나만 lease 를 얻고 나머지는 busy', async () => {
    const now = new Date()
    const rs = await Promise.allSettled([1, 2, 3].map(() => startObserve(CH, now)))
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of rs.filter((r) => r.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'busy' })
    }
  })

  it('lease 만료 후에는 다른 실행이 다시 얻는다', async () => {
    const t0 = new Date()
    await startObserve(CH, t0)
    await expect(startObserve(CH, new Date(t0.getTime() + 5 * MIN))).rejects.toMatchObject({
      code: 'busy',
    })
    await expect(startObserve(CH, new Date(t0.getTime() + 16 * MIN))).resolves.toBeDefined()
  })

  it('ingest: 멱등 upsert — 같은 해시는 unchanged, 바뀌면 updated', async () => {
    const t0 = new Date()
    const { operationId } = await startObserve(CH, t0)
    expect(await ingestLines(operationId, [line('a'), line('b')], t0)).toMatchObject({ created: 2 })
    expect(await ingestLines(operationId, [line('a'), line('b')], t0)).toMatchObject({
      unchanged: 2,
      created: 0,
    })
    expect(
      await ingestLines(operationId, [line('a', { channelStatus: 'DISPATCHED' })], t0)
    ).toMatchObject({ updated: 1 })
    expect(await prisma.channelOrderLine.count({ where: { channelId: CH } })).toBe(2)
  })

  it('ingest: 원본 변경 시각이 저장값보다 오래되면 덮어쓰지 않는다', async () => {
    const t0 = new Date()
    const { operationId } = await startObserve(CH, t0)
    await ingestLines(
      operationId,
      [line('a', { channelStatus: 'NEW', sourceChangedAt: '2026-11-21T10:00:00.000Z' })],
      t0
    )
    const r = await ingestLines(
      operationId,
      [line('a', { channelStatus: 'OLD', sourceChangedAt: '2026-11-21T09:00:00.000Z' })],
      t0
    )
    expect(r.staleSkipped).toBe(1)
    const row = await prisma.channelOrderLine.findFirstOrThrow({
      where: { channelId: CH, externalLineKey: 'a' },
    })
    expect(row.channelStatus).toBe('NEW')
  })

  it('ingest: 개인정보 필드가 있으면 거부하고 아무것도 쓰지 않는다', async () => {
    const t0 = new Date()
    const { operationId } = await startObserve(CH, t0)
    await expect(
      ingestLines(operationId, [line('a'), line('b', { recipientName: '홍길동' })], t0)
    ).rejects.toMatchObject({ code: 'invalid' })
    expect(await prisma.channelOrderLine.count({ where: { channelId: CH } })).toBe(0)
  })

  it('만료된 operation 의 ingest 는 거부되고 행이 바뀌지 않는다', async () => {
    const t0 = new Date()
    const { operationId } = await startObserve(CH, t0)
    await ingestLines(operationId, [line('a')], t0)
    await expect(
      ingestLines(
        operationId,
        [line('a', { channelStatus: 'LATE' })],
        new Date(t0.getTime() + 16 * MIN)
      )
    ).rejects.toBeInstanceOf(ChannelOrderError)
    const row = await prisma.channelOrderLine.findFirstOrThrow({
      where: { channelId: CH, externalLineKey: 'a' },
    })
    expect(row.channelStatus).toBe('PAYED')
  })

  it('교체된(새 lease 가 잡힌) operation 의 ingest·finish 는 거부된다', async () => {
    const t0 = new Date()
    const first = await startObserve(CH, t0)
    const t1 = new Date(t0.getTime() + 20 * MIN)
    const second = await startObserve(CH, t1)
    await expect(ingestLines(first.operationId, [line('a')], t1)).rejects.toMatchObject({
      code: 'lease_lost',
    })
    const fin = await finishObserve(
      {
        operationId: first.operationId,
        success: true,
        through: t1.toISOString(),
        pagesRequested: 1,
        pagesIngested: 1,
      },
      t1
    )
    expect(fin.accepted).toBe(false)
    expect(await cursorOf()).toBeNull()
    // 새 operation 은 영향 없이 계속 진행
    await expect(ingestLines(second.operationId, [line('a')], t1)).resolves.toBeDefined()
  })

  it('커서는 전체 성공 finish 에서만 전진한다 — 페이지 누락·실패는 그대로', async () => {
    const t0 = new Date()
    const a = await startObserve(CH, t0)
    const missing = await finishObserve(
      {
        operationId: a.operationId,
        success: true,
        through: t0.toISOString(),
        pagesRequested: 3,
        pagesIngested: 2,
      },
      t0
    )
    expect(missing).toMatchObject({ accepted: true, status: 'FAILED' })
    expect(await cursorOf()).toBeNull()

    const b = await startObserve(CH, t0) // finish 가 lease 를 풀었으므로 바로 재시도(같은 창)
    expect(b.cursor).toBeNull()
    const failed = await finishObserve(
      { operationId: b.operationId, success: false, errorCode: 'api_error' },
      t0
    )
    expect(failed.status).toBe('FAILED')
    expect(await cursorOf()).toBeNull()

    const c = await startObserve(CH, t0)
    const ok = await finishObserve(
      {
        operationId: c.operationId,
        success: true,
        through: t0.toISOString(),
        pagesRequested: 2,
        pagesIngested: 2,
      },
      t0
    )
    expect(ok.status).toBe('SUCCEEDED')
    expect((await cursorOf())?.at).toBe(t0.toISOString())
  })

  it('중간 실패 후 다음 실행은 같은 창부터 다시 시작한다', async () => {
    const t0 = new Date()
    const a = await startObserve(CH, t0)
    const w1 = planWindows('cafe24', a.cursor, t0)
    await finishObserve({ operationId: a.operationId, success: false, errorCode: 'api_error' }, t0)
    const b = await startObserve(CH, t0)
    expect(planWindows('cafe24', b.cursor, t0)).toEqual(w1)
  })

  it('이미 마감된 operation 의 두 번째 finish 는 거부', async () => {
    const t0 = new Date()
    const a = await startObserve(CH, t0)
    const input = {
      operationId: a.operationId,
      success: true,
      through: t0.toISOString(),
      pagesRequested: 1,
      pagesIngested: 1,
    }
    expect((await finishObserve(input, t0)).accepted).toBe(true)
    expect((await finishObserve(input, t0)).accepted).toBe(false)
  })

  it('커서는 뒤로 가지 않는다', async () => {
    const t0 = new Date()
    const a = await startObserve(CH, t0)
    await finishObserve(
      {
        operationId: a.operationId,
        success: true,
        through: t0.toISOString(),
        pagesRequested: 1,
        pagesIngested: 1,
      },
      t0
    )
    const b = await startObserve(CH, t0)
    const back = await finishObserve(
      {
        operationId: b.operationId,
        success: true,
        through: new Date(t0.getTime() - 60 * MIN).toISOString(),
        pagesRequested: 1,
        pagesIngested: 1,
      },
      t0
    )
    expect(back.status).toBe('FAILED')
    expect((await cursorOf())?.at).toBe(t0.toISOString())
  })

  it('15분 넘은 STARTED operation 은 정리되어 FAILED(timeout)', async () => {
    const t0 = new Date(Date.now() - 30 * MIN)
    const a = await startObserve(CH, t0)
    await cleanupStaleOperations(new Date())
    const op = await prisma.pipelineOperation.findUniqueOrThrow({ where: { id: a.operationId } })
    expect(op).toMatchObject({ status: 'FAILED', error: 'timeout' })
  })

  it('전수 조회: 부분·구조 이상은 SUCCEEDED 가 아니고, 만료 후 ingest 는 거부', async () => {
    const t0 = new Date()
    const a = await startFullScan(CH, t0)
    await ingestScanLines(
      a.operationId,
      [
        {
          externalLineKey: 'a',
          externalOrderId: 'o',
          quantity: 1,
          channelStatus: 'S',
          paidAt: t0.toISOString(),
        },
      ],
      t0
    )
    const base = { periodFrom: t0.toISOString(), periodTo: t0.toISOString() }
    const part = await finishFullScan(
      {
        operationId: a.operationId,
        success: false,
        ...base,
        pagesRequested: 3,
        pagesReceived: 1,
        structureOk: true,
      },
      t0
    )
    expect(part.status).toBe('PARTIAL')

    const b = await startFullScan(CH, t0)
    const bad = await finishFullScan(
      {
        operationId: b.operationId,
        success: true,
        ...base,
        pagesRequested: 1,
        pagesReceived: 1,
        structureOk: false,
      },
      t0
    )
    expect(bad.status).toBe('PARTIAL')

    const c = await startFullScan(CH, t0)
    await expect(
      ingestScanLines(
        c.operationId,
        [
          {
            externalLineKey: 'a',
            externalOrderId: 'o',
            quantity: 1,
            channelStatus: 'S',
            paidAt: t0.toISOString(),
          },
        ],
        new Date(t0.getTime() + 16 * MIN)
      )
    ).rejects.toMatchObject({ code: 'lease_lost' })
  })

  it('수집기가 빈 결과로 끝나도(전수 조회 없음) 대사는 판정 불가이지 성공이 아니다', async () => {
    await prisma.channelFulfillmentSetting.update({
      where: { channelId: CH },
      data: { reconcileMode: 'judge' },
    })
    const s = await prisma.channelFulfillmentSetting.findUniqueOrThrow({
      where: { channelId: CH },
      include: { channel: { select: { id: true, name: true } } },
    })
    const t0 = new Date()
    const a = await startObserve(CH, t0)
    await finishObserve(
      {
        operationId: a.operationId,
        success: true,
        through: t0.toISOString(),
        pagesRequested: 1,
        pagesIngested: 1,
        rows: 0,
      },
      t0
    )
    const fresh = await prisma.channelFulfillmentSetting.findUniqueOrThrow({
      where: { channelId: CH },
      include: { channel: { select: { id: true, name: true } } },
    })
    const out = await reconcileChannel(fresh, t0)
    expect(out.mode).toBe('unjudgeable')
    expect(s.reconcileMode).toBe('judge')
  })
})
