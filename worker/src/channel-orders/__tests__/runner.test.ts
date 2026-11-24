/** @jest-environment node */
import {
  WorkerApiError,
  type ChannelOrdersFinish,
  type ChannelOrdersStart,
} from '../../api-client.js'
import { runChannelOrders, type ChannelOrdersDeps } from '../runner.js'
import type { NaverHttp } from '../naver.js'
import type { CoupangGet } from '../coupang.js'

const TRACE = { traceId: 't' }
const W1 = { from: '2026-11-23T15:00:00.000Z', to: '2026-11-24T15:00:00.000Z' }
const W2 = { from: '2026-11-24T15:00:00.000Z', to: '2026-11-25T01:00:00.000Z' }
const statusRow = (id: string) => ({
  productOrderId: id,
  lastChangedDate: '2026-11-24T10:00:00.000+09:00',
})
const queryRow = (id: string) => ({
  order: { orderId: `O-${id}`, paymentDate: '2026-11-24T09:00:00.000+09:00' },
  productOrder: {
    productOrderId: id,
    productName: '상품',
    quantity: 1,
    productOrderStatus: 'PAYED',
  },
})
const scanContent = (id: string) => ({
  productOrderId: id,
  content: { order: queryRow(id).order, productOrder: queryRow(id).productOrder },
})
const sheet = (box: number) => ({
  shipmentBoxId: box,
  orderId: box,
  paidAt: '2026-11-24T09:00:00',
  status: 'ACCEPT',
  orderItems: [{ vendorItemId: 1, vendorItemName: 'n', shippingCount: 1 }],
})

/** 상태 페이지(ids 묶음들)를 moreSequence 로 이어주는 가짜 네이버. */
function fakeNaver(
  pagesOfIds: string[][],
  opts: { shortQuery?: boolean; onPage?: (n: number) => void } = {}
): NaverHttp {
  return async (_m, path, params, body) => {
    if (path.endsWith('last-changed-statuses')) {
      const n = Number(params?.moreSequence ?? 0)
      opts.onPage?.(n)
      const ids = pagesOfIds[n]
      if (!ids) throw new Error('unexpected page')
      return {
        ...TRACE,
        data: {
          lastChangeStatuses: ids.map(statusRow),
          ...(n + 1 < pagesOfIds.length
            ? { more: { moreFrom: '2026-11-24T10:00:00.000+09:00', moreSequence: String(n + 1) } }
            : {}),
        },
      }
    }
    const q = (body as { productOrderIds: string[] }).productOrderIds
    return { ...TRACE, data: (opts.shortQuery ? q.slice(1) : q).map(queryRow) }
  }
}

type Fake = {
  ingests: { operationId: string; lines: unknown[] }[]
  finishes: ChannelOrdersFinish[]
  starts: { channelId: string; kind: string }[]
  logs: string[]
}
function makeDeps(
  over: Partial<ChannelOrdersDeps> = {},
  startOver: Partial<ChannelOrdersStart> | ((kind: string) => Partial<ChannelOrdersStart>) = {},
  adapter = 'naver'
) {
  const fake: Fake = { ingests: [], finishes: [], starts: [], logs: [] }
  const deps: Partial<ChannelOrdersDeps> = {
    keys: () => ['tok'],
    getPlan: async () => ({ items: [{ channelId: 'ch1', adapter, storeKey: 's1' }] }),
    start: async (body) => {
      fake.starts.push(body)
      const o = typeof startOver === 'function' ? startOver(body.kind) : startOver
      return {
        operationId: `op-${body.kind}`,
        storeKey: 's1',
        windows: [W1, W2],
        secret: { clientId: 'CID', clientSecret: 'CSECRET' },
        vendorId: 'A001',
        ...o,
      }
    },
    ingest: async (b) => void fake.ingests.push(b),
    finish: async (b) => {
      fake.finishes.push(b)
      return { accepted: true, status: b.success ? 'SUCCEEDED' : 'FAILED' }
    },
    getApiCredential: async () => ({
      vendorId: 'A001',
      accessKey: 'AK',
      secretKey: 'CIPHER',
      encryptionIv: 'IV',
      isActive: true,
    }),
    decrypt: () => 'PLAIN-COUPANG-SECRET',
    naverHttp: async () => fakeNaver([['A', 'B']]),
    coupangGet: () => async () => ({ data: [], nextToken: '' }),
    deadlineMs: 12 * 60_000,
    log: (l) => fake.logs.push(l),
    ...over,
  }
  return { deps, fake }
}
const obs = (f: ChannelOrdersFinish) => f as Extract<ChannelOrdersFinish, { pagesIngested: number }>
const scan = (f: ChannelOrdersFinish) =>
  f as Extract<ChannelOrdersFinish, { pagesReceived: number }>

describe('runChannelOrders — 네이버', () => {
  it('여러 페이지(창마다 +more): 요청 수 = 적재 수, through = 마지막 창 끝', async () => {
    // 창 2개 × (상태 페이지 2장) 이라 같은 fake 를 창마다 처음부터
    const { deps, fake } = makeDeps({ naverHttp: async () => fakeNaver([['A'], ['B', 'C']]) })
    const r = await runChannelOrders('OBSERVE', undefined, deps)
    expect(r.ok).toBe(1)
    const f = obs(fake.finishes[0])
    expect(f).toMatchObject({
      success: true,
      through: W2.to,
      pagesRequested: 4,
      pagesIngested: 4,
      rows: 6,
    })
    expect(fake.ingests.length).toBeGreaterThanOrEqual(f.pagesIngested)
    expect(f.errorCode).toBeUndefined()
  })
  it('빈 페이지도 ingest 1회([])', async () => {
    const { deps, fake } = makeDeps({ naverHttp: async () => async () => TRACE })
    await runChannelOrders('OBSERVE', undefined, deps)
    expect(fake.ingests).toEqual([
      { operationId: 'op-OBSERVE', lines: [] },
      { operationId: 'op-OBSERVE', lines: [] },
    ])
    expect(obs(fake.finishes[0])).toMatchObject({
      success: true,
      pagesRequested: 2,
      pagesIngested: 2,
      rows: 0,
    })
  })
  it('300행 초과 페이지는 300행씩 나눠 ingest 하고 모두 성공해야 1페이지', async () => {
    const ids = Array.from({ length: 650 }, (_, i) => `P${i}`)
    const { deps, fake } = makeDeps({ naverHttp: async () => fakeNaver([ids]) }, { windows: [W1] })
    await runChannelOrders('OBSERVE', undefined, deps)
    expect(fake.ingests.map((i) => i.lines.length)).toEqual([300, 300, 50])
    expect(obs(fake.finishes[0])).toMatchObject({
      success: true,
      pagesRequested: 1,
      pagesIngested: 1,
      rows: 650,
    })
  })
  it('중간 페이지 실패: 요청 수 ≠ 적재 수 + 실패 마감(커서 전진 없음)', async () => {
    let n = 0
    const http: NaverHttp = async (m, p, q, b) => {
      // 둘째 창 첫 장에서 query 건수 부족
      if (p.endsWith('last-changed-statuses')) n++
      return fakeNaver([['A', 'B']], { shortQuery: n === 2 })(m, p, q, b)
    }
    const { deps, fake } = makeDeps({ naverHttp: async () => http })
    const r = await runChannelOrders('OBSERVE', undefined, deps)
    expect(r.failed).toBe(1)
    const f = obs(fake.finishes[0])
    expect(f).toMatchObject({
      success: false,
      pagesRequested: 2,
      pagesIngested: 1,
      errorCode: 'structure_invalid',
    })
    expect(f.through).toBeUndefined()
  })
  it('ingest 409 → lease_lost', async () => {
    const { deps, fake } = makeDeps({
      ingest: async () => {
        throw new WorkerApiError(409, 'x')
      },
    })
    await runChannelOrders('OBSERVE', undefined, deps)
    expect(obs(fake.finishes[0])).toMatchObject({
      success: false,
      errorCode: 'lease_lost',
      pagesRequested: 1,
      pagesIngested: 0,
    })
  })
  it('secret null → auth_error 마감, 외부 호출 없음', async () => {
    const naverHttp = jest.fn()
    const { deps, fake } = makeDeps({ naverHttp }, { secret: null })
    await runChannelOrders('OBSERVE', undefined, deps)
    expect(naverHttp).not.toHaveBeenCalled()
    expect(fake.finishes[0]).toMatchObject({
      success: false,
      errorCode: 'auth_error',
      pagesRequested: 0,
    })
  })
  it('토큰 발급 실패 → auth_error, 비밀값이 로그에 없다', async () => {
    const { deps, fake } = makeDeps({
      naverHttp: async () => {
        throw new Error('token 401 CSECRET')
      },
    })
    await runChannelOrders('OBSERVE', undefined, deps)
    expect(fake.finishes[0]).toMatchObject({ success: false, errorCode: 'auth_error' })
    expect(fake.logs.join('\n')).not.toContain('CSECRET')
  })
  it('12분 시한이 지나면 다음 페이지를 요청하지 않고 timeout 마감', async () => {
    let t = 0
    const { deps, fake } = makeDeps({
      now: () => t,
      ingest: async () => {
        t += 13 * 60_000 // 첫 페이지 적재 직후 시한 초과
      },
      naverHttp: async () => fakeNaver([['A'], ['B']]),
    })
    await runChannelOrders('OBSERVE', undefined, deps)
    expect(obs(fake.finishes[0])).toMatchObject({
      success: false,
      errorCode: 'timeout',
      pagesRequested: 1,
      pagesIngested: 1,
    })
  })
  it('finish 가 accepted/SUCCEEDED 가 아니면 ok 로 세지 않고 로그에 서버 결과를 남긴다', async () => {
    const { deps, fake } = makeDeps({
      finish: async () => ({ accepted: false, status: 'FAILED' }),
    })
    const r = await runChannelOrders('OBSERVE', undefined, deps)
    expect(r.ok).toBe(0)
    expect(r.failed).toBe(1)
    expect(fake.logs.join('\n')).toContain('status=FAILED accepted=false')
  })
  it('요청 제한 시간 초과(AbortError): 시한 전이면 api_error, 시한 후면 timeout', async () => {
    for (const [late, code] of [
      [false, 'api_error'],
      [true, 'timeout'],
    ] as const) {
      let t = 0
      const { deps, fake } = makeDeps({
        now: () => t,
        naverHttp: async () => async () => {
          if (late) t += 13 * 60_000
          throw new DOMException('aborted', 'TimeoutError')
        },
      })
      await runChannelOrders('OBSERVE', undefined, deps)
      expect(fake.finishes[0]).toMatchObject({ success: false, errorCode: code })
    }
  })
  it('start 409(busy)·404 → 건너뜀, finish 없음', async () => {
    for (const status of [409, 404]) {
      const { deps, fake } = makeDeps({
        start: async () => {
          throw new WorkerApiError(status, 'busy')
        },
      })
      const r = await runChannelOrders('DAILY', undefined, deps)
      expect(r).toMatchObject({ skipped: 2, ok: 0, failed: 0 })
      expect(fake.finishes).toHaveLength(0)
    }
  })
  it('DAILY: OBSERVE 다음 FULL_SCAN, 전수 마감 값(periodTo = 마지막 창 끝)', async () => {
    const http: NaverHttp = async (_m, path, params) => {
      if (path.endsWith('last-changed-statuses')) return TRACE
      return {
        ...TRACE,
        data: {
          contents: [scanContent(`S${params?.page}`)],
          pagination: { hasNext: params?.page === '1' },
        },
      }
    }
    const { deps, fake } = makeDeps({ naverHttp: async () => http })
    const r = await runChannelOrders('DAILY', 'naver', deps)
    expect(fake.starts.map((s) => s.kind)).toEqual(['OBSERVE', 'FULL_SCAN'])
    expect(r.ok).toBe(2)
    expect(scan(fake.finishes[1])).toMatchObject({
      success: true,
      periodFrom: W1.from,
      periodTo: W2.to,
      pagesRequested: 4,
      pagesReceived: 4,
      structureOk: true,
    })
    expect(fake.ingests.filter((i) => i.operationId === 'op-FULL_SCAN')).toHaveLength(4)
  })
  it('FULL_SCAN 구조 오류 → structureOk false', async () => {
    const { deps, fake } = makeDeps({ naverHttp: async () => async () => ({}) }, { windows: [W1] })
    await runChannelOrders('DAILY', 'naver', deps)
    expect(scan(fake.finishes[1])).toMatchObject({
      success: false,
      structureOk: false,
      errorCode: 'structure_invalid',
    })
  })
  it('adapter 필터: 쿠팡만 지정하면 네이버 채널은 시작하지 않는다', async () => {
    const { deps, fake } = makeDeps()
    await runChannelOrders('OBSERVE', 'coupang', deps)
    expect(fake.starts).toHaveLength(0)
  })
})

describe('runChannelOrders — 쿠팡', () => {
  const sheetsGet: CoupangGet = async (path, q) => {
    if (path.endsWith('returnRequests')) return { data: [] }
    return q?.status === 'ACCEPT'
      ? { data: [sheet(1)], nextToken: '' }
      : { data: [], nextToken: '' }
  }
  it('정상: 로컬 복호화한 키로 호출, 평문 키는 start·ingest·finish·로그 어디에도 없다', async () => {
    const cfgs: unknown[] = []
    const { deps, fake } = makeDeps(
      { coupangGet: (cfg) => (cfgs.push(cfg), sheetsGet) },
      { windows: [W1], secret: undefined },
      'coupang'
    )
    await runChannelOrders('OBSERVE', undefined, deps)
    expect(cfgs).toEqual([{ vendorId: 'A001', accessKey: 'AK', secretKey: 'PLAIN-COUPANG-SECRET' }])
    // 6 상태 + 취소 목록 1
    expect(obs(fake.finishes[0])).toMatchObject({
      success: true,
      pagesRequested: 7,
      pagesIngested: 7,
      rows: 1,
    })
    const all = JSON.stringify([fake.ingests, fake.finishes, fake.logs])
    expect(all).not.toContain('PLAIN-COUPANG-SECRET')
    expect(all).not.toContain('CIPHER')
  })
  it('vendorId 불일치 / 서버 vendorId null / 자격증명 없음 → auth_error', async () => {
    for (const [startOver, cred] of [
      [{ vendorId: 'A999' }, undefined],
      [{ vendorId: null }, undefined],
      [{}, null],
    ] as const) {
      const coupangGet = jest.fn()
      const { deps, fake } = makeDeps(
        {
          coupangGet,
          ...(cred === null ? { getApiCredential: async () => null } : {}),
        },
        startOver,
        'coupang'
      )
      await runChannelOrders('OBSERVE', undefined, deps)
      expect(coupangGet).not.toHaveBeenCalled()
      expect(fake.finishes[0]).toMatchObject({
        success: false,
        errorCode: 'auth_error',
        pagesRequested: 0,
      })
    }
  })
  it('복호화 실패 → auth_error', async () => {
    const { deps, fake } = makeDeps(
      {
        decrypt: () => {
          throw new Error('bad')
        },
      },
      {},
      'coupang'
    )
    await runChannelOrders('OBSERVE', undefined, deps)
    expect(fake.finishes[0]).toMatchObject({ errorCode: 'auth_error' })
  })
  it('쿠팡 구조 오류(data 없음) → structure_invalid, 적재 0', async () => {
    const { deps, fake } = makeDeps(
      { coupangGet: () => async () => ({}) },
      { windows: [W1] },
      'coupang'
    )
    await runChannelOrders('OBSERVE', undefined, deps)
    expect(obs(fake.finishes[0])).toMatchObject({
      success: false,
      errorCode: 'structure_invalid',
      pagesRequested: 1,
      pagesIngested: 0,
    })
  })
})
