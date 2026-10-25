import { runNaverNbaesongSync, type NbaesongDeps } from '../naver-nbaesong-runner.js'

const secret = {
  stores: {
    s1: { clientId: 'CID1', clientSecret: 'SECRET-ONE' },
    s2: { clientId: 'CID2', clientSecret: 'SECRET-TWO' },
  },
}
const plan = (stores: { key: string; days: string[] }[]) => ({
  items: [{ spaceId: 'sp', credentialId: 'c', secrets: secret.stores, stores }],
})

function makeDeps(over: Partial<NbaesongDeps> = {}) {
  const logs: string[] = []
  const deps = {
    keys: () => ['wdw_T1'],
    getPlan: jest.fn(async () =>
      plan([{ key: 's1', days: ['2026-10-20', '2026-10-21', '2026-10-22'] }])
    ),
    issueToken: jest.fn(async () => 'TOKEN-XYZ'),
    fetchOrders: jest.fn(async () => [{ orderId: 'o' }] as never),
    ingest: jest.fn(async () => undefined),
    finish: jest.fn(async () => undefined),
    delay: jest.fn(async () => undefined),
    log: (m: string) => logs.push(m),
    ...over,
  } satisfies NbaesongDeps
  return { deps, logs }
}

describe('runNaverNbaesongSync', () => {
  it('정상: 모든 날 ingest 후 finish', async () => {
    const { deps } = makeDeps()
    await expect(runNaverNbaesongSync(deps)).resolves.toEqual({ stores: 1, days: 3, failed: 0 })
    expect(deps.issueToken).toHaveBeenCalledTimes(1)
    expect(deps.ingest).toHaveBeenCalledTimes(3)
    expect(deps.finish).toHaveBeenCalledWith(
      {
        spaceId: 'sp',
        storeKey: 's1',
        attempted: ['2026-10-20', '2026-10-21', '2026-10-22'],
        ok: ['2026-10-20', '2026-10-21', '2026-10-22'],
      },
      'wdw_T1'
    )
  })

  it('secrets=null(앱 복호화 실패): 호출 없이 실패로 finish', async () => {
    const { deps } = makeDeps({
      getPlan: jest.fn(async () => ({
        items: [
          {
            spaceId: 'sp',
            credentialId: 'c',
            secrets: null,
            stores: [{ key: 's1', days: ['2026-10-20'] }],
          },
        ],
      })),
    })
    await expect(runNaverNbaesongSync(deps)).resolves.toEqual({ stores: 1, days: 1, failed: 1 })
    expect(deps.issueToken).not.toHaveBeenCalled()
    expect(deps.finish).toHaveBeenCalledWith(
      expect.objectContaining({ ok: [], error: '자격증명 복호화 실패' }),
      'wdw_T1'
    )
  })

  it('토큰 실패: 전 일자 실패로 finish', async () => {
    const { deps, logs } = makeDeps({
      issueToken: jest.fn(async () => {
        throw new Error('naver-commerce token 401: bad')
      }),
    })
    await expect(runNaverNbaesongSync(deps)).resolves.toEqual({ stores: 1, days: 3, failed: 3 })
    expect(deps.fetchOrders).not.toHaveBeenCalled()
    expect(deps.finish).toHaveBeenCalledWith(
      {
        spaceId: 'sp',
        storeKey: 's1',
        attempted: ['2026-10-20', '2026-10-21', '2026-10-22'],
        ok: [],
        error: 'naver-commerce token 401: bad',
      },
      'wdw_T1'
    )
    expect(logs.length).toBe(1)
  })

  it('하루 fetch 실패: 나머지는 ingest, finish ok 에서 제외', async () => {
    const { deps } = makeDeps({
      fetchOrders: jest.fn(async (_t: string, day: string) => {
        if (day === '2026-10-21') throw new Error('boom')
        return [] as never
      }),
    })
    await expect(runNaverNbaesongSync(deps)).resolves.toEqual({ stores: 1, days: 3, failed: 1 })
    expect(deps.ingest).toHaveBeenCalledTimes(2)
    expect(deps.finish).toHaveBeenCalledWith(
      {
        spaceId: 'sp',
        storeKey: 's1',
        attempted: ['2026-10-20', '2026-10-21', '2026-10-22'],
        ok: ['2026-10-20', '2026-10-22'],
        error: 'boom',
      },
      'wdw_T1'
    )
  })

  it('ingest 실패도 해당 일만 실패', async () => {
    const { deps } = makeDeps({
      ingest: jest.fn(async (a: { dayKst: string }) => {
        if (a.dayKst === '2026-10-20') throw new Error('ingest 500')
      }),
    })
    await expect(runNaverNbaesongSync(deps)).resolves.toEqual({ stores: 1, days: 3, failed: 1 })
  })

  it('로그에 비밀값 없음', async () => {
    const { deps, logs } = makeDeps({
      fetchOrders: jest.fn(async () => {
        throw new Error('boom')
      }),
    })
    await runNaverNbaesongSync(deps)
    const all = logs.join('\n')
    for (const s of ['SECRET-ONE', 'SECRET-TWO', 'TOKEN-XYZ', 'CID1']) expect(all).not.toContain(s)
    expect(logs.length).toBe(1)
  })

  it('스토어/일자 사이 delay, 자격증명 없는 스토어는 실패 finish', async () => {
    const { deps } = makeDeps({
      getPlan: jest.fn(async () =>
        plan([
          { key: 's1', days: ['2026-10-20', '2026-10-21'] },
          { key: 'nope', days: ['2026-10-20'] },
        ])
      ),
    })
    const r = await runNaverNbaesongSync(deps)
    expect(r).toEqual({ stores: 2, days: 3, failed: 1 })
    expect(deps.delay).toHaveBeenCalled()
    expect(deps.finish).toHaveBeenLastCalledWith(
      expect.objectContaining({ storeKey: 'nope', ok: [], error: expect.any(String) }),
      'wdw_T1'
    )
  })

  it('토큰마다 plan 을 받고 ingest·finish 에 같은 토큰을 쓴다', async () => {
    const getPlan = jest.fn(async (k?: string) => ({
      items: [
        {
          spaceId: k === 'wdw_A' ? 'spA' : 'spB',
          credentialId: 'c',
          secrets: secret.stores,
          stores: [{ key: 's1', days: ['2026-10-20'] }],
        },
      ],
    }))
    const { deps } = makeDeps({ keys: () => ['wdw_A', 'wdw_B'], getPlan })
    await expect(runNaverNbaesongSync(deps)).resolves.toEqual({ stores: 2, days: 2, failed: 0 })
    expect(getPlan.mock.calls).toEqual([['wdw_A'], ['wdw_B']])
    expect(deps.ingest).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'spA' }), 'wdw_A')
    expect(deps.finish).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'spB' }), 'wdw_B')
  })

  it('한 토큰의 plan 실패는 건너뛰고 나머지 space 는 계속, 로그에 토큰 없음', async () => {
    const { deps, logs } = makeDeps({
      keys: () => ['wdw_BAD', 'wdw_OK'],
      getPlan: jest.fn(async (k?: string) => {
        if (k === 'wdw_BAD')
          throw new Error('API 요청 실패 [401]: /api/collection/naver-nbaesong/plan')
        return plan([{ key: 's1', days: ['2026-10-20'] }])
      }),
    })
    await expect(runNaverNbaesongSync(deps)).resolves.toEqual({ stores: 1, days: 1, failed: 0 })
    expect(logs[0]).toContain('plan 실패')
    expect(logs.join('\n')).not.toContain('wdw_')
  })

  it('NAVER_NBAESONG_WORKER_TOKENS 를 쉼표로 나눠 쓰고, 비면 기본 키로 한 번 호출', async () => {
    const getPlan = jest.fn(async (_k?: string) => plan([{ key: 's1', days: ['2026-10-20'] }]))
    const { deps } = makeDeps({ getPlan })
    const { keys: _k, ...withoutKeys } = deps
    const prev = process.env.NAVER_NBAESONG_WORKER_TOKENS
    try {
      process.env.NAVER_NBAESONG_WORKER_TOKENS = ' wdw_1 , wdw_2 ,'
      await runNaverNbaesongSync(withoutKeys)
      expect(getPlan.mock.calls).toEqual([['wdw_1'], ['wdw_2']])
      getPlan.mockClear()
      delete process.env.NAVER_NBAESONG_WORKER_TOKENS
      await runNaverNbaesongSync(withoutKeys)
      expect(getPlan.mock.calls).toEqual([[undefined]])
    } finally {
      if (prev === undefined) delete process.env.NAVER_NBAESONG_WORKER_TOKENS
      else process.env.NAVER_NBAESONG_WORKER_TOKENS = prev
    }
  })
})
