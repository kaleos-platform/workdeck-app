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
    expect(deps.finish).toHaveBeenCalledWith({
      spaceId: 'sp',
      storeKey: 's1',
      attempted: ['2026-10-20', '2026-10-21', '2026-10-22'],
      ok: ['2026-10-20', '2026-10-21', '2026-10-22'],
    })
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
      expect.objectContaining({ ok: [], error: '자격증명 복호화 실패' })
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
    expect(deps.finish).toHaveBeenCalledWith({
      spaceId: 'sp',
      storeKey: 's1',
      attempted: ['2026-10-20', '2026-10-21', '2026-10-22'],
      ok: [],
      error: 'naver-commerce token 401: bad',
    })
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
    expect(deps.finish).toHaveBeenCalledWith({
      spaceId: 'sp',
      storeKey: 's1',
      attempted: ['2026-10-20', '2026-10-21', '2026-10-22'],
      ok: ['2026-10-20', '2026-10-22'],
      error: 'boom',
    })
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
      expect.objectContaining({ storeKey: 'nope', ok: [], error: expect.any(String) })
    )
  })
})
