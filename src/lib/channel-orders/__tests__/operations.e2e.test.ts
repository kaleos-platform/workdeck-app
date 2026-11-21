/**
 * 실 DB(dev) — lease·커서의 조건부 쓰기가 Postgres 에서 기대대로 동작하는지.
 * 만든 데이터는 afterAll 에서 지운다.
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { cafe24Get } from '@/lib/cafe24/client'
import { resolveAnyDeckContext } from '@/lib/api-helpers'
import { runCafe24Daily, runCafe24Observe } from '../adapters/cafe24'
import { ingestLines, ingestScanLines } from '../ingest'
import {
  cleanupStaleOperations,
  finishFullScan,
  finishObserve,
  planWindows,
  scanWindows,
  startFullScan,
  startObserve,
} from '../operations'
import { reconcileChannel } from '../reconcile-run'
import { ChannelOrderError, type ObserveCursor } from '../types'
import { PUT as putObserveSetting } from '../../../../app/api/channels/[channelId]/order-observe/route'

jest.mock('@/lib/cafe24/client', () => ({
  ...jest.requireActual('@/lib/cafe24/client'),
  cafe24Get: jest.fn(),
}))
jest.mock('@/lib/api-helpers', () => ({
  ...jest.requireActual('@/lib/api-helpers'),
  resolveAnyDeckContext: jest.fn(),
}))
const mockGet = cafe24Get as jest.Mock
const mockCtx = resolveAnyDeckContext as jest.Mock

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip
if (!RUN) {
  console.warn('[operations.e2e] dev DB 없음으로 건너뜀 — lease·커서·대사 e2e 가 실행되지 않았다')
}

const SP = 'e2e00000-0000-4000-8000-0000000c0de1'
const CH = 'e2e00000-0000-4000-8000-0000000c0de2'
const CH2 = 'e2e00000-0000-4000-8000-0000000c0de3'
const MIN = 60_000
const DAY = 86_400_000

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

const scanLine = (key: string, paidAt: Date, over: Record<string, unknown> = {}) => ({
  externalLineKey: key,
  externalOrderId: `O-${key}`,
  quantity: 1,
  channelStatus: 'N10',
  paidAt: paidAt.toISOString(),
  ...over,
})

/** 성공한 관측 1회 + 계획한 모든 일자 창을 ingest 한 성공 전수 조회(첫 창에 lines). 판정 게이트를 통과하는 상태를 만든다. */
const healthyRun = async (t0: Date, scanLines: ReturnType<typeof scanLine>[] = []) => {
  const o = await startObserve(CH, t0)
  await ingestLines(o.operationId, [line('seed')], t0)
  await finishObserve(
    {
      operationId: o.operationId,
      success: true,
      through: t0.toISOString(),
      pagesRequested: 1,
      pagesIngested: 1,
    },
    t0
  )
  const sc = await startFullScan(CH, t0)
  const days = scanWindows(t0).length
  for (let i = 0; i < days; i++) await ingestScanLines(sc.operationId, i ? [] : scanLines, t0)
  const fin = await finishFullScan(
    {
      operationId: sc.operationId,
      success: true,
      periodFrom: t0.toISOString(),
      periodTo: t0.toISOString(),
      pagesRequested: days,
      pagesReceived: days,
      structureOk: true,
    },
    t0
  )
  return { sc, fin }
}

const judgeSettingRow = () =>
  prisma.channelFulfillmentSetting.findUniqueOrThrow({
    where: { channelId: CH },
    include: { channel: { select: { id: true, name: true } } },
  })

const c24Order = (
  code: string,
  paidAt: Date,
  status: string,
  item: Record<string, unknown> = {}
) => ({
  order_id: `OID-${code}`,
  payment_date: paidAt.toISOString(),
  canceled: 'F',
  items: [
    { order_item_code: code, product_name: '상품', quantity: 1, order_status: status, ...item },
  ],
})
const serveCafe24 = (orders: ReturnType<typeof c24Order>[]) =>
  mockGet.mockImplementation(
    async (_sp: string, _mall: string | null, _path: string, q: Record<string, unknown>) => {
      const day = (iso: string) =>
        new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10)
      const hit = orders.filter(
        (o) =>
          day(o.payment_date) >= String(q.start_date) && day(o.payment_date) <= String(q.end_date)
      )
      return { orders: hit.slice(Number(q.offset), Number(q.offset) + Number(q.limit)) }
    }
  )

const putSetting = async (channelId: string, body: unknown) =>
  (await putObserveSetting(
    new NextRequest('http://localhost/api/channels/x/order-observe', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ channelId }) }
  ))!

const reset = async () => {
  mockGet.mockReset()
  mockGet.mockResolvedValue({ orders: [] })
  mockCtx.mockResolvedValue({ space: { id: SP }, role: 'ADMIN' })
  await prisma.channelFulfillmentSetting.deleteMany({ where: { channelId: CH2 } })
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
    await prisma.channel.upsert({
      where: { id: CH2 },
      update: {},
      create: { id: CH2, spaceId: SP, name: 'E2E 채널2' },
    })
    // 쇼핑몰 행(복호화하지 않으므로 암호문은 더미) — 레거시 cafe24 + 새 cafe24:<mallId>
    for (const [provider, mallId] of [
      ['cafe24', 'myshop24'],
      ['cafe24:shop-b', 'shop-b'],
    ]) {
      await prisma.spaceCredential.upsert({
        where: { spaceId_provider: { spaceId: SP, provider } },
        update: {},
        create: {
          spaceId: SP,
          provider,
          encryptedPayload: 'x',
          iv: 'x',
          config: { mallId, credVersion: 1, status: 'connected' },
        },
      })
    }
    await prisma.channelFulfillmentSetting.upsert({
      where: { channelId: CH },
      update: {
        observeEnabled: true,
        adapter: 'cafe24',
        reconcileMode: 'diagnose',
        matchKeyRule: Prisma.DbNull,
      },
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
    await ingestLines(c.operationId, [line('a')], t0)
    await ingestLines(c.operationId, [line('b')], t0) // 신고한 2페이지만큼 서버도 2번 받아야 한다
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
    await ingestLines(a.operationId, [line('a')], t0)
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
    await ingestLines(a.operationId, [line('a')], t0)
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
    await ingestLines(b.operationId, [line('a')], t0)
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
    const t0 = new Date()
    const a = await startObserve(CH, t0)
    await ingestLines(a.operationId, [], t0)
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
    const out = await reconcileChannel(await judgeSettingRow(), t0)
    expect(out).toMatchObject({ mode: 'unjudgeable' })
    expect((out as { reasons: string[] }).reasons).toContain('scan_missing')
  })

  describe('서버가 계획한 창·호출 수 검증(5)', () => {
    beforeEach(() =>
      prisma.channelFulfillmentSetting.update({
        where: { channelId: CH },
        data: { reconcileMode: 'judge', matchKeyRule: { field: 'externalOrderId' } },
      })
    )

    it('ingest 없이 success 로 마감한 빈 전수 조회는 SUCCEEDED 가 아니고 게이트를 통과하지 못한다', async () => {
      const t0 = new Date()
      const o = await startObserve(CH, t0)
      await ingestLines(o.operationId, [], t0)
      await finishObserve(
        {
          operationId: o.operationId,
          success: true,
          through: t0.toISOString(),
          pagesRequested: 1,
          pagesIngested: 1,
        },
        t0
      )
      const sc = await startFullScan(CH, t0)
      const fin = await finishFullScan(
        {
          operationId: sc.operationId,
          success: true,
          periodFrom: new Date(t0.getTime() - 7 * DAY).toISOString(),
          periodTo: t0.toISOString(),
          pagesRequested: 0,
          pagesReceived: 0,
          structureOk: true,
        },
        t0
      )
      expect(fin.status).not.toBe('SUCCEEDED')
      const out = await reconcileChannel(await judgeSettingRow(), t0)
      expect(out.mode).toBe('unjudgeable')
      expect((out as { reasons: string[] }).reasons).toEqual(['scan_incomplete'])
    })

    it('일수보다 적게 ingest 했거나 계획과 다른 끝 시각을 신고하면 성공이 아니다', async () => {
      const t0 = new Date()
      const days = scanWindows(t0).length
      const a = await startFullScan(CH, t0)
      for (let i = 0; i < days - 1; i++) await ingestScanLines(a.operationId, [], t0)
      const short = await finishFullScan(
        {
          operationId: a.operationId,
          success: true,
          periodFrom: t0.toISOString(),
          periodTo: t0.toISOString(),
          pagesRequested: days,
          pagesReceived: days,
          structureOk: true,
        },
        t0
      )
      expect(short.status).not.toBe('SUCCEEDED')

      const b = await startFullScan(CH, t0)
      for (let i = 0; i < days; i++) await ingestScanLines(b.operationId, [], t0)
      const wrongEnd = await finishFullScan(
        {
          operationId: b.operationId,
          success: true,
          periodFrom: t0.toISOString(),
          periodTo: new Date(t0.getTime() - 3 * DAY).toISOString(),
          pagesRequested: days,
          pagesReceived: days,
          structureOk: true,
        },
        t0
      )
      expect(wrongEnd.status).not.toBe('SUCCEEDED')
    })

    it('전수 조회 counts 의 기간은 서버가 저장한 계획값이다', async () => {
      const t0 = new Date()
      const { sc, fin } = await healthyRun(t0)
      expect(fin.status).toBe('SUCCEEDED')
      const op = await prisma.pipelineOperation.findUniqueOrThrow({ where: { id: sc.operationId } })
      expect(op.counts).toMatchObject({
        periodFrom: scanWindows(t0)[0].from.toISOString(),
        periodTo: t0.toISOString(),
      })
    })

    it('관측: ingest 호출이 없으면 커서가 전진하지 않는다', async () => {
      const t0 = new Date()
      const a = await startObserve(CH, t0)
      const r = await finishObserve(
        {
          operationId: a.operationId,
          success: true,
          through: t0.toISOString(),
          pagesRequested: 1,
          pagesIngested: 1,
        },
        t0
      )
      expect(r.status).toBe('FAILED')
      expect(await cursorOf()).toBeNull()
    })

    it('정상 마감된 전수 조회 + 신선한 관측이면 게이트를 통과해 판정한다(reasons 없음)', async () => {
      const t0 = new Date()
      await healthyRun(t0)
      const out = await reconcileChannel(await judgeSettingRow(), t0)
      expect(out.mode).toBe('judge')
    })
  })

  describe('판정 창 W 통합(1+2)', () => {
    it('W 밖(8일 전) 결제 scan 행은 관측에 없어도 A 가 아니고, W 안 행은 A', async () => {
      await prisma.channelFulfillmentSetting.update({
        where: { channelId: CH },
        data: { reconcileMode: 'judge', matchKeyRule: { field: 'externalOrderId' } },
      })
      const t0 = new Date()
      const wFrom = scanWindows(t0)[0].from
      await healthyRun(t0, [
        scanLine('old', new Date(wFrom.getTime() - 3_600_000)),
        scanLine('in', new Date(wFrom.getTime() + 3_600_000)),
      ])
      const out = await reconcileChannel(await judgeSettingRow(), t0)
      expect(out.mode).toBe('judge')
      const a = (out as { verdict: { A: Array<{ ref: string }> } }).verdict.A
      expect(a.map((f) => f.ref)).toEqual(['O-in'])
    })
  })

  describe('finish 경합(6)', () => {
    it('동시 finish 두 번: 하나만 성공하고 SUCCEEDED 는 덮어쓰이지 않는다', async () => {
      for (let n = 0; n < 4; n++) {
        const t0 = new Date()
        const a = await startObserve(CH, t0)
        await ingestLines(a.operationId, [line('a')], t0)
        const input = {
          operationId: a.operationId,
          success: true,
          through: t0.toISOString(),
          pagesRequested: 1,
          pagesIngested: 1,
        }
        const rs = await Promise.all([finishObserve(input, t0), finishObserve(input, t0)])
        expect(rs.filter((r) => r.accepted)).toHaveLength(1)
        expect(rs.find((r) => r.accepted)?.status).toBe('SUCCEEDED')
        const op = await prisma.pipelineOperation.findUniqueOrThrow({
          where: { id: a.operationId },
        })
        expect(op).toMatchObject({ status: 'SUCCEEDED', error: null })
        await reset()
      }
    })
  })

  describe('ingest 한도(7)', () => {
    it('관측·전수 모두 한 번에 300행까지, 초과는 invalid(400)', async () => {
      const t0 = new Date()
      const o = await startObserve(CH, t0)
      const mk = (n: number) => Array.from({ length: n }, (_, i) => line(`k${i}`))
      await expect(ingestLines(o.operationId, mk(301), t0)).rejects.toMatchObject({
        code: 'invalid',
      })
      await expect(ingestLines(o.operationId, mk(300), t0)).resolves.toMatchObject({ created: 300 })
      const sc = await startFullScan(CH, t0)
      const sk = (n: number) => Array.from({ length: n }, (_, i) => scanLine(`k${i}`, t0))
      await expect(ingestScanLines(sc.operationId, sk(301), t0)).rejects.toMatchObject({
        code: 'invalid',
      })
      await expect(ingestScanLines(sc.operationId, sk(300), t0)).resolves.toMatchObject({
        inserted: 300,
      })
    })
  })

  it('전수 조회 행은 (operationId, externalLineKey) 로 중복 제거된다', async () => {
    const t0 = new Date()
    const sc = await startFullScan(CH, t0)
    await ingestScanLines(sc.operationId, [scanLine('a', t0), scanLine('a', t0)], t0)
    await ingestScanLines(sc.operationId, [scanLine('a', t0), scanLine('b', t0)], t0)
    expect(
      await prisma.channelOrderScanLine.count({ where: { operationId: sc.operationId } })
    ).toBe(2)
  })

  describe('카페24 어댑터(API 모킹)', () => {
    it('증분 관측은 8일 겹침으로 5일 전 결제 행의 어제 출고 상태를 따라잡는다(3)', async () => {
      const t0 = new Date()
      const paid = new Date(t0.getTime() - 5 * DAY)
      await prisma.channelOrderLine.create({
        data: {
          spaceId: SP,
          channelId: CH,
          externalLineKey: 'K5',
          externalOrderId: 'OID-K5',
          paidAt: paid,
          productName: '상품',
          quantity: 1,
          channelStatus: 'N10',
          deliveryKind: 'NORMAL',
          rawHash: 'old',
        },
      })
      await prisma.$executeRaw`UPDATE "ChannelFulfillmentSetting" SET "observeCursor" = ${JSON.stringify({ at: new Date(t0.getTime() - 30 * MIN).toISOString(), catchingUp: false })}::jsonb WHERE "channelId" = ${CH}`
      serveCafe24([
        c24Order('K5', paid, 'N30', {
          tracking_no: 'T1',
          shipped_date: new Date(t0.getTime() - DAY).toISOString(),
        }),
      ])
      const r = await runCafe24Observe(CH, t0)
      expect(r).toMatchObject({ status: 'SUCCEEDED' })
      const row = await prisma.channelOrderLine.findFirstOrThrow({
        where: { channelId: CH, externalLineKey: 'K5' },
      })
      expect(row).toMatchObject({ channelStatus: 'N30', trackingNumber: 'T1' })
    })

    it('ChannelOrderError 는 lease_lost 로 뭉개지 않고 그 code 로 기록된다(8)', async () => {
      const t0 = new Date()
      serveCafe24([c24Order('X'.repeat(301), t0, 'N10')]) // 키가 한도(300) 초과 → ingest invalid
      const r = await runCafe24Observe(CH, t0)
      expect(r).toMatchObject({ status: 'FAILED', error: 'invalid' })
      const op = await prisma.pipelineOperation.findFirstOrThrow({
        where: { channelId: CH, kind: 'OBSERVE' },
      })
      expect(op.error).toBe('invalid')
    })

    it('일일 실행은 증분 관측을 먼저 끝낸 뒤 전수 조회를 시작한다(4)', async () => {
      const r = await runCafe24Daily(CH)
      expect(r.observe).toMatchObject({ status: 'SUCCEEDED' })
      expect(r.scan).toMatchObject({ status: 'SUCCEEDED' })
      const ops = await prisma.pipelineOperation.findMany({ where: { channelId: CH } })
      const obs = ops.find((o) => o.kind === 'OBSERVE')!
      const full = ops.find((o) => o.kind === 'FULL_SCAN')!
      expect(obs.finishedAt!.getTime()).toBeLessThanOrEqual(full.startedAt.getTime())
    })
  })

  describe('설정 라우트 PUT(10·11)', () => {
    it('MEMBER 는 거부(403)', async () => {
      mockCtx.mockResolvedValue({ space: { id: SP }, role: 'MEMBER' })
      const res = await putSetting(CH, {
        observeEnabled: true,
        adapter: 'cafe24',
        storeKey: 'myshop24',
        reconcileMode: 'judge',
      })
      expect(res.status).toBe(403)
    })
    it('reconcileMode·matchKeyRule 검증: 잘못된 값은 400, 올바르면 저장', async () => {
      const bad = await putSetting(CH, {
        observeEnabled: true,
        adapter: 'cafe24',
        storeKey: 'myshop24',
        reconcileMode: 'x',
      })
      expect(bad.status).toBe(400)
      const badRule = await putSetting(CH, {
        observeEnabled: true,
        adapter: 'cafe24',
        storeKey: 'myshop24',
        matchKeyRule: { field: 'recipientName' },
      })
      expect(badRule.status).toBe(400)
      const ok = await putSetting(CH, {
        observeEnabled: true,
        adapter: 'cafe24',
        storeKey: 'myshop24',
        reconcileMode: 'judge',
        matchKeyRule: { field: 'lineKeyOrderPart' },
      })
      expect(ok.status).toBe(200)
      const row = await prisma.channelFulfillmentSetting.findUniqueOrThrow({
        where: { channelId: CH },
      })
      expect(row).toMatchObject({
        reconcileMode: 'judge',
        matchKeyRule: { field: 'lineKeyOrderPart' },
      })
    })
    it('카페24 는 켤 때 쇼핑몰 필수·연결된 몰만 — 없으면 400', async () => {
      expect((await putSetting(CH, { observeEnabled: true, adapter: 'cafe24' })).status).toBe(400)
      const ghost = await putSetting(CH, {
        observeEnabled: true,
        adapter: 'cafe24',
        storeKey: 'ghost-shop',
      })
      expect(ghost.status).toBe(400)
    })
    it('같은 쇼핑몰의 관측 채널은 1개만(null storeKey 는 레거시 몰) — 다른 몰이면 허용', async () => {
      // CH 는 storeKey null(레거시 myshop24 로 해석)
      const second = await putSetting(CH2, {
        observeEnabled: true,
        adapter: 'cafe24',
        storeKey: 'myshop24',
      })
      expect(second.status).toBe(409)
      expect((await second.json()).message).toContain('카페24')
      const other = await putSetting(CH2, {
        observeEnabled: true,
        adapter: 'cafe24',
        storeKey: 'shop-b',
      })
      expect(other.status).toBe(200)
      const naver = await putSetting(CH2, { observeEnabled: true, adapter: 'naver', storeKey: 's' })
      expect(naver.status).toBe(200)
    })
    it('레거시 채널(storeKey null)을 레거시 몰로 다시 저장하면 커서를 유지한다', async () => {
      const cursor = { at: new Date().toISOString(), catchingUp: false }
      await prisma.channelFulfillmentSetting.update({
        where: { channelId: CH },
        data: { adapter: 'cafe24', storeKey: null, observeEnabled: true, observeCursor: cursor },
      })
      const res = await putSetting(CH, {
        observeEnabled: true,
        adapter: 'cafe24',
        storeKey: 'myshop24',
      })
      expect(res.status).toBe(200)
      const row = await prisma.channelFulfillmentSetting.findUniqueOrThrow({
        where: { channelId: CH },
      })
      expect(row.storeKey).toBe('myshop24')
      expect(row.observeCursor).toEqual(cursor)
    })
    it('몰을 바꾸면 커서·lease 를 비우고 진행 중 operation 을 setting_changed 로 닫는다', async () => {
      await prisma.channelFulfillmentSetting.update({
        where: { channelId: CH },
        data: { adapter: 'cafe24', storeKey: 'shop-b', observeEnabled: true },
      })
      const started = await startObserve(CH, new Date())
      await prisma.channelFulfillmentSetting.update({
        where: { channelId: CH },
        data: { observeCursor: { at: new Date().toISOString(), catchingUp: false } },
      })
      const res = await putSetting(CH, {
        observeEnabled: true,
        adapter: 'cafe24',
        storeKey: 'myshop24',
      })
      expect(res.status).toBe(200)
      const row = await prisma.channelFulfillmentSetting.findUniqueOrThrow({
        where: { channelId: CH },
      })
      expect(row.observeLease).toBeNull()
      expect(row.observeCursor).toBeNull()
      const op = await prisma.pipelineOperation.findUniqueOrThrow({
        where: { id: started.operationId },
      })
      expect(op).toMatchObject({ status: 'FAILED', error: 'setting_changed' })
      await expect(ingestLines(started.operationId, [line('Z1')])).rejects.toBeInstanceOf(
        ChannelOrderError
      )
    })
  })
})
