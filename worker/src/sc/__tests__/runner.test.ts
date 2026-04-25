// runner.ts — routeJob kind 별 라우팅 유닛 테스트.
// Prisma/HTTP mock 없음 — deps 주입으로 순수 라우팅 로직만 검증.

import { routeJob, type RouteDeps } from '../runner'

// ────────────────────────────────────────────────
// 공통 헬퍼
// ────────────────────────────────────────────────

function makeJob(
  kind: 'PUBLISH' | 'COLLECT_METRIC' | 'INSIGHT_SWEEP',
  overrides?: Partial<{
    targetId: string | null
    payload: unknown
    deployment: unknown
    credential: unknown
    assets: unknown
    deploymentUrl: unknown
  }>
) {
  return {
    job: {
      id: 'job-1',
      kind,
      targetId: overrides?.targetId ?? null,
      payload: overrides?.payload ?? {},
      attempts: 0,
    },
    deployment: overrides?.deployment ?? undefined,
    credential: overrides?.credential ?? undefined,
    assets: overrides?.assets ?? undefined,
    deploymentUrl: overrides?.deploymentUrl ?? undefined,
  }
}

// 신 contract: channel/content 는 deployment 에 임베디드, assets/deploymentUrl 은 top-level.
function publishDeployment(channelOverrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    targetUrl: 'https://example.com',
    shortSlug: 's1',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    channel: {
      id: 'c1',
      name: 'ch',
      platform: 'THREADS',
      publisherMode: 'API',
      config: {},
      ...channelOverrides,
    },
    content: { id: 'ct1', title: 'T', doc: {} },
  }
}

function collectDeployment(channelOverrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    platformUrl: 'https://blog.naver.com/post/1',
    shortSlug: 's1',
    channel: {
      id: 'c1',
      platform: 'BLOG_NAVER',
      collectorMode: 'BROWSER',
      config: {},
      ...channelOverrides,
    },
  }
}

/** routeJob 테스트용 최소 deps — 각 테스트에서 재정의 */
function makeDeps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  const mockPublisher = {
    name: 'mock-publisher',
    publish: jest.fn().mockResolvedValue({ ok: true }),
  }
  const mockCollector = {
    name: 'mock-collector',
    collect: jest.fn().mockResolvedValue({ ok: true }),
  }

  return {
    getPublisher: jest.fn().mockReturnValue(mockPublisher),
    getCollector: jest.fn().mockReturnValue(mockCollector),
    handleInsightSweep: jest.fn().mockResolvedValue({ ok: true }),
    reportMetrics: jest.fn().mockResolvedValue({ ok: true, count: 0 }),
    ...overrides,
  }
}

// ────────────────────────────────────────────────
// PUBLISH 브랜치
// ────────────────────────────────────────────────

describe('routeJob — PUBLISH', () => {
  it('deployment/channel/content 가 없으면 ok:false 를 반환한다', async () => {
    const deps = makeDeps()
    const result = await routeJob(makeJob('PUBLISH'), deps)
    expect(result.ok).toBe(false)
    expect(result.errorMessage).toMatch(/PublishContext/)
    expect(deps.getPublisher).not.toHaveBeenCalled()
  })

  it('getPublisher 가 던지면 ok:false 를 반환한다', async () => {
    const deps = makeDeps({
      getPublisher: jest.fn().mockImplementation(() => {
        throw new Error('Publisher 미구현')
      }),
    })
    const job = makeJob('PUBLISH', {
      deployment: publishDeployment(),
      assets: [],
      deploymentUrl: 'http://example.com/c/s1',
    })
    const result = await routeJob(job, deps)
    expect(result.ok).toBe(false)
    expect(result.errorMessage).toContain('Publisher 미구현')
  })

  it('publisher.publish 성공 시 ok:true + platformUrl 을 전달한다', async () => {
    const mockPublisher = {
      name: 'mock',
      publish: jest.fn().mockResolvedValue({ ok: true, platformUrl: 'https://threads.net/abc' }),
    }
    const deps = makeDeps({ getPublisher: jest.fn().mockReturnValue(mockPublisher) })
    const job = makeJob('PUBLISH', {
      deployment: publishDeployment(),
      assets: [],
      deploymentUrl: 'http://example.com/c/s1',
    })
    const result = await routeJob(job, deps)
    expect(result.ok).toBe(true)
    expect(result.platformUrl).toBe('https://threads.net/abc')
  })

  it('publisher.publish 가 AUTH_FAILED 를 반환해도 result 를 그대로 전달한다', async () => {
    const mockPublisher = {
      name: 'threads-api',
      publish: jest
        .fn()
        .mockResolvedValue({ ok: false, errorCode: 'AUTH_FAILED', errorMessage: '토큰 없음' }),
    }
    const deps = makeDeps({ getPublisher: jest.fn().mockReturnValue(mockPublisher) })
    const job = makeJob('PUBLISH', {
      deployment: publishDeployment(),
      assets: [],
      deploymentUrl: 'http://example.com/c/s1',
    })
    const result = await routeJob(job, deps)
    expect(result.ok).toBe(false)
    expect(result.errorMessage).toBe('토큰 없음')
  })

  it('assets/deploymentUrl 이 PublishContext 로 전달된다', async () => {
    const mockPublisher = {
      name: 'mock',
      publish: jest.fn().mockResolvedValue({ ok: true }),
    }
    const deps = makeDeps({ getPublisher: jest.fn().mockReturnValue(mockPublisher) })
    const job = makeJob('PUBLISH', {
      deployment: publishDeployment(),
      assets: [{ slotKey: 'thumb', url: 'https://x/y.png', alt: null }],
      deploymentUrl: 'http://example.com/c/s1',
    })
    await routeJob(job, deps)
    expect(mockPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: [{ slotKey: 'thumb', url: 'https://x/y.png', alt: null }],
        deploymentUrl: 'http://example.com/c/s1',
      })
    )
  })
})

// ────────────────────────────────────────────────
// COLLECT_METRIC 브랜치
// ────────────────────────────────────────────────

describe('routeJob — COLLECT_METRIC', () => {
  it('deployment 없으면 ok:false 를 반환한다', async () => {
    const deps = makeDeps()
    const result = await routeJob(makeJob('COLLECT_METRIC'), deps)
    expect(result.ok).toBe(false)
    expect(result.errorMessage).toMatch(/CollectContext/)
    expect(deps.getCollector).not.toHaveBeenCalled()
  })

  it('getCollector 가 null 을 반환하면 ok:true 로 완료 처리', async () => {
    const deps = makeDeps({ getCollector: jest.fn().mockReturnValue(null) })
    const job = makeJob('COLLECT_METRIC', {
      deployment: collectDeployment({ collectorMode: 'NONE', platform: 'THREADS' }),
    })
    const result = await routeJob(job, deps)
    expect(result.ok).toBe(true)
  })

  it('collector.collect 성공 시 ok:true 반환', async () => {
    const mockCollector = {
      name: 'mock',
      collect: jest.fn().mockResolvedValue({ ok: true, metrics: [] }),
    }
    const deps = makeDeps({ getCollector: jest.fn().mockReturnValue(mockCollector) })
    const job = makeJob('COLLECT_METRIC', { deployment: collectDeployment() })
    const result = await routeJob(job, deps)
    expect(result.ok).toBe(true)
    expect(mockCollector.collect).toHaveBeenCalledTimes(1)
  })

  it('collect 결과에 metrics 가 있으면 reportMetrics 가 호출된다', async () => {
    const mockCollector = {
      name: 'mock',
      collect: jest.fn().mockResolvedValue({
        ok: true,
        metrics: [
          { date: new Date('2026-04-25T00:00:00Z'), views: 12, likes: 3, comments: 1 },
          { date: new Date('2026-04-26T00:00:00Z'), views: 30, likes: 5, comments: 2 },
        ],
      }),
    }
    const mockReport = jest.fn().mockResolvedValue({ ok: true, count: 2 })
    const deps = makeDeps({
      getCollector: jest.fn().mockReturnValue(mockCollector),
      reportMetrics: mockReport,
    })
    const job = makeJob('COLLECT_METRIC', { deployment: collectDeployment() })
    const result = await routeJob(job, deps)
    expect(result.ok).toBe(true)
    expect(mockReport).toHaveBeenCalledTimes(1)
    const [deploymentId, metrics] = mockReport.mock.calls[0]
    expect(deploymentId).toBe('d1')
    expect(metrics).toHaveLength(2)
    expect(metrics[0]).toMatchObject({ source: 'BROWSER', views: 12, likes: 3, comments: 1 })
    expect(metrics[0].date).toBe('2026-04-25T00:00:00.000Z')
  })

  it('reportMetrics 가 실패해도 collect 자체는 ok:true 로 보고된다', async () => {
    const mockCollector = {
      name: 'mock',
      collect: jest.fn().mockResolvedValue({
        ok: true,
        metrics: [{ date: new Date('2026-04-25T00:00:00Z'), views: 1 }],
      }),
    }
    const mockReport = jest.fn().mockResolvedValue({ ok: false, count: 0, errorMessage: '500' })
    const deps = makeDeps({
      getCollector: jest.fn().mockReturnValue(mockCollector),
      reportMetrics: mockReport,
    })
    const result = await routeJob(
      makeJob('COLLECT_METRIC', { deployment: collectDeployment() }),
      deps
    )
    expect(result.ok).toBe(true)
    expect(mockReport).toHaveBeenCalledTimes(1)
  })

  it('collector.collect 가 AUTH_FAILED 를 반환하면 ok:false + errorMessage 전달', async () => {
    const mockCollector = {
      name: 'naver-blog-browser',
      collect: jest.fn().mockResolvedValue({
        ok: false,
        errorCode: 'AUTH_FAILED',
        errorMessage: 'storageState 없음',
      }),
    }
    const deps = makeDeps({ getCollector: jest.fn().mockReturnValue(mockCollector) })
    const job = makeJob('COLLECT_METRIC', { deployment: collectDeployment() })
    const result = await routeJob(job, deps)
    expect(result.ok).toBe(false)
    expect(result.errorMessage).toBe('storageState 없음')
  })
})

// ────────────────────────────────────────────────
// INSIGHT_SWEEP 브랜치
// ────────────────────────────────────────────────

describe('routeJob — INSIGHT_SWEEP', () => {
  it('handleInsightSweep 를 호출하고 결과를 전달한다', async () => {
    const mockHandle = jest.fn().mockResolvedValue({ ok: true, meta: { createdRules: 3 } })
    const deps = makeDeps({ handleInsightSweep: mockHandle })
    const job = makeJob('INSIGHT_SWEEP', { targetId: 'space-abc' })
    const result = await routeJob(job, deps)
    expect(result.ok).toBe(true)
    expect(mockHandle).toHaveBeenCalledWith(
      expect.objectContaining({ job: expect.objectContaining({ kind: 'INSIGHT_SWEEP' }) })
    )
  })

  it('handleInsightSweep 가 실패하면 ok:false + errorMessage 전달', async () => {
    const mockHandle = jest.fn().mockResolvedValue({ ok: false, errorMessage: 'spaceId 없음' })
    const deps = makeDeps({ handleInsightSweep: mockHandle })
    const result = await routeJob(makeJob('INSIGHT_SWEEP'), deps)
    expect(result.ok).toBe(false)
    expect(result.errorMessage).toBe('spaceId 없음')
  })
})
