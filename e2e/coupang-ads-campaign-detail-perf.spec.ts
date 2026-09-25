import { expect, Page, Request, test } from '@playwright/test'

const EMAIL = process.env.E2E_TEST_EMAIL ?? ''
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? ''
const CAMPAIGN_ID = process.env.E2E_COUPANG_ADS_CAMPAIGN_ID ?? ''

test.skip(
  !EMAIL || !PASSWORD || !CAMPAIGN_ID,
  'E2E_TEST_EMAIL / E2E_TEST_PASSWORD / E2E_COUPANG_ADS_CAMPAIGN_ID 미설정 — 인증 성능 E2E 생략'
)

async function loginUser(page: Page) {
  await page.goto('/login')

  await page
    .getByLabel(/이메일/i)
    .or(page.locator('input[type="email"]'))
    .first()
    .fill(EMAIL)
  await page
    .getByLabel(/비밀번호/i)
    .or(page.locator('input[type="password"]'))
    .first()
    .fill(PASSWORD)

  await page
    .getByRole('button', { name: /로그인/i })
    .first()
    .click()
  await page.waitForURL(/\/my-deck|\/dashboard/, { timeout: 10_000 })
}

test.describe('쿠팡 광고 캠페인 상세 초기 요청', () => {
  test('대시보드 진입 시 비활성 tab API를 호출하지 않는다', async ({ page }) => {
    await loginUser(page)

    const campaignApiPaths: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/campaigns')) {
        campaignApiPaths.push(url.pathname)
      }
    })

    const overviewResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.status() === 200 && url.pathname === `/api/campaigns/${CAMPAIGN_ID}/overview`
    })

    await page.goto(`/d/coupang-ads/campaigns/${CAMPAIGN_ID}`)
    await overviewResponse
    await expect(page.getByRole('tab', { name: '대시보드' })).toHaveAttribute(
      'data-state',
      'active'
    )

    // mount 직후 지연된 effect까지 관찰한다.
    await page.waitForTimeout(500)

    const uniquePaths = [...new Set(campaignApiPaths)]
    expect(uniquePaths).toEqual(
      expect.arrayContaining(['/api/campaigns', `/api/campaigns/${CAMPAIGN_ID}/overview`])
    )
    expect(
      uniquePaths.filter(
        (path) =>
          path.endsWith('/records') ||
          path.endsWith('/inefficient-keywords') ||
          path.endsWith('/product-analysis') ||
          path.endsWith('/product-trends')
      )
    ).toEqual([])
    expect(uniquePaths).toHaveLength(2)
  })
})

test('첫 화면은 캠페인별 목표 요약 API 없이 성과를 표시한다', async ({ page }) => {
  await loginUser(page)
  const requests: string[] = []
  page.on('request', (request) => requests.push(new URL(request.url()).pathname))
  const campaignResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/campaigns' && url.searchParams.has('startDate')
  })
  await page.goto('/d/coupang-ads')
  const response = await campaignResponse
  expect(response.ok()).toBeTruthy()
  const campaigns = (await response.json()) as Array<{
    id: string
    displayName: string
    metrics: { totalAdCost: number; totalRevenue: number }
    summary: { budgetUtilization: number | null; roasAchievement: number | null }
  }>
  const campaign = campaigns.find((c) => c.metrics.totalAdCost > 0 || c.metrics.totalRevenue > 0)
  expect(campaign, '최근 7일 광고 데이터가 있는 테스트 workspace가 필요합니다').toBeDefined()
  await expect(
    page
      .locator(`a[href^="/d/coupang-ads/campaigns/${campaign!.id}?"]`)
      .filter({ hasText: '총 광고비' })
  ).toBeVisible()
  expect(campaign!.summary).toHaveProperty('budgetUtilization')
  expect(requests.filter((path) => path.endsWith('/targets/summary'))).toEqual([])
})

test('배포 환경에서 첫 진입·재진입 표시 시간을 5회 측정한다', async ({ page }, testInfo) => {
  test.skip(process.env.E2E_COUPANG_ADS_PERF !== '1', '배포 성능 측정 시에만 활성화')
  test.setTimeout(600_000)
  await loginUser(page)
  const samples: Array<{ screen: string; ms: number; serverTiming: string | null }> = []
  const requests: Array<{
    path: string
    rsc: boolean
    vercelId: string | null
    serverTiming: string | null
    timing: ReturnType<Request['timing']>
    failed: boolean
  }> = []
  const pending: Promise<void>[] = []
  let collectionFailures = 0
  const collectRequest = (request: Request) => {
    const url = new URL(request.url())
    if (!/^\/(d\/coupang-ads|api\/campaigns|api\/dashboard)(?:\/|$)/.test(url.pathname)) return
    pending.push(
      (async () => {
        const response = await request.response()
        // 쿠키·본문·쿼리 문자열 없이 서버 로그와 연결할 식별자와 시간만 남긴다.
        requests.push({
          path: url.pathname,
          rsc: request.headers().rsc === '1',
          vercelId: response?.headers()['x-vercel-id'] ?? null,
          serverTiming: response?.headers()['server-timing'] ?? null,
          timing: request.timing(),
          failed: request.failure() !== null,
        })
      })().catch(() => {
        // 페이지 종료 등 수집 실패가 원래 테스트 오류나 attachment 저장을 가리지 않게 한다.
        collectionFailures += 1
      })
    )
  }
  page.on('requestfinished', collectRequest)
  page.on('requestfailed', collectRequest)

  async function home(action: () => Promise<unknown>, screen: string) {
    const campaignResponse = page.waitForResponse(
      (response) => {
        const url = new URL(response.url())
        return url.pathname === '/api/campaigns' && url.searchParams.has('startDate')
      },
      { timeout: 60_000 }
    )
    const kpiResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/dashboard/kpi',
      { timeout: 60_000 }
    )
    const start = performance.now()
    await action()
    const link = page
      .locator(`a[href^="/d/coupang-ads/campaigns/${CAMPAIGN_ID}?"]`)
      .filter({ hasText: '총 광고비' })
    await expect(link).toBeVisible()
    const adCostCard = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]').filter({ hasText: /^총 광고비$/ }),
    })
    await expect(adCostCard.locator('.text-2xl')).toHaveText(/^[\d,]+원$/)
    // 초기 서버 데이터 표시 시간과 이후 API 재검증 완료 시간을 분리한다.
    const readyMs = performance.now() - start
    const [response, kpi] = await Promise.all([campaignResponse, kpiResponse])
    expect(response.ok()).toBeTruthy()
    expect(kpi.ok()).toBeTruthy()
    const campaigns = (await response.json()) as Array<{
      id: string
      metrics: { totalAdCost: number; totalRevenue: number }
    }>
    const campaign = campaigns.find(
      (c) => c.id === CAMPAIGN_ID && (c.metrics.totalAdCost > 0 || c.metrics.totalRevenue > 0)
    )
    expect(campaign, '지정 캠페인에 최근 7일 성과 데이터가 필요합니다').toBeDefined()
    const { adCost } = (await kpi.json()) as { adCost: number }
    await expect(
      page
        .locator('[data-slot="card"]')
        .filter({
          has: page.locator('[data-slot="card-title"]').filter({ hasText: /^총 광고비$/ }),
        })
        .getByText(`${adCost.toLocaleString('ko-KR')}원`, { exact: true })
    ).toBeVisible()
    samples.push({
      screen,
      ms: readyMs,
      serverTiming: response.headers()['server-timing'] ?? null,
    })
    return link
  }

  async function detail(action: () => Promise<unknown>, screen: string) {
    const overviewResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/campaigns/${CAMPAIGN_ID}/overview`,
      { timeout: 60_000 }
    )
    const start = performance.now()
    await action()
    const response = await overviewResponse
    expect(response.ok()).toBeTruthy()
    const overview = (await response.json()) as {
      campaign: { displayName: string }
      metricSeries: unknown[]
    }
    expect(overview.metricSeries.length).toBeGreaterThan(0)
    await expect(
      page.getByRole('heading', { name: overview.campaign.displayName, exact: true })
    ).toBeVisible()
    await expect(page.locator('.recharts-surface').first()).toBeVisible()
    samples.push({
      screen,
      ms: performance.now() - start,
      serverTiming: response.headers()['server-timing'] ?? null,
    })
  }

  try {
    for (let i = 0; i < 5; i++) {
      // 이미지 등 전체 load 완료를 기다리면 데이터가 먼저 표시된 시간을 놓친다.
      const link = await home(() => page.goto('/d/coupang-ads', { waitUntil: 'commit' }), 'first')
      await detail(() => link.click(), 'detail')
      const revisitLink = await home(
        () => page.locator('a[href="/d/coupang-ads"]').first().click(),
        'revisit'
      )
      await detail(() => revisitLink.click(), 'detail_revisit')
    }
  } finally {
    page.off('requestfinished', collectRequest)
    page.off('requestfailed', collectRequest)
    await Promise.all(pending)
    await testInfo.attach('coupang-ads-performance.json', {
      body: JSON.stringify(samples, null, 2),
      contentType: 'application/json',
    })
    await testInfo.attach('coupang-ads-performance-requests.json', {
      body: JSON.stringify({ requests, collectionFailures }, null, 2),
      contentType: 'application/json',
    })
  }
  expect.soft(collectionFailures, '요청 계측 수집 실패 수').toBe(0)
  for (const sample of samples) {
    expect
      .soft(sample.ms, `${sample.screen}: ${sample.ms.toFixed(0)}ms`)
      .toBeLessThanOrEqual(sample.screen.includes('revisit') ? 1000 : 3000)
  }
})

// 삭제 가능한 합성 데이터 workspace에서만 명시적으로 실행한다.
test('테스트 workspace에서 캠페인 이름 변경 후 현재 화면과 재진입 화면이 갱신된다', async ({
  page,
}) => {
  test.skip(process.env.E2E_COUPANG_ADS_MUTATION !== '1', '일회용 테스트 workspace에서만 실행')
  test.setTimeout(120_000)
  // production mode에서는 변경 전에 홈 데이터까지 미리 불러온 상태를 검증한다.
  const homePrefetch =
    process.env.E2E_COUPANG_ADS_PREFETCH === '1'
      ? page.waitForResponse(
          async (r) =>
            new URL(r.url()).pathname === '/d/coupang-ads' &&
            r.request().headers().rsc === '1' &&
            (await r.text()).includes('"initialData":'),
          { timeout: 30_000 }
        )
      : null
  await loginUser(page)
  if (homePrefetch) {
    expect(await (await homePrefetch).text()).toContain('"initialData":')
    await page.locator('a[href="/d/coupang-ads"]').first().click()
  } else {
    await page.goto('/d/coupang-ads')
  }
  const card = page
    .locator(`a[href^="/d/coupang-ads/campaigns/${CAMPAIGN_ID}?"]`)
    .filter({ hasText: '총 광고비' })
  const overviewResponse = page.waitForResponse((r) =>
    r.url().includes(`/api/campaigns/${CAMPAIGN_ID}/overview`)
  )
  await card.click()
  const overview = await overviewResponse
  expect(overview.status()).toBe(200)
  const { campaign } = (await overview.json()) as { campaign: { displayName: string } }
  const heading = page.getByRole('heading', { level: 1 })
  const original = campaign.displayName
  await expect(heading).toHaveText(original)
  const changed = `${original} 갱신 검증`
  try {
    await heading.locator('..').locator('button').click()
    const input = page.locator('input.text-xl')
    await input.fill(changed)
    const response = page.waitForResponse(
      (r) => r.url().endsWith(`/api/campaigns/${CAMPAIGN_ID}`) && r.request().method() === 'PATCH'
    )
    await input.press('Enter')
    expect((await response).status()).toBe(200)
    await expect(heading).toHaveText(changed)
    await expect(
      page.locator(`a[href="/d/coupang-ads/campaigns/${CAMPAIGN_ID}"]`).first()
    ).toContainText(changed)
    if (homePrefetch) {
      // 백그라운드 API가 이전 Router Cache의 값을 나중에 고치는 것으로 통과하지 않게 한다.
      await page.route('**/api/campaigns?*startDate=*', (route) => route.abort())
      await page.route('**/api/dashboard/kpi?*', (route) => route.abort())
    }
    await page.locator('a[href="/d/coupang-ads"]').first().click()
    await expect(card).toContainText(changed)
    await card.click()
    await expect(heading).toHaveText(changed)
  } finally {
    const restored = await page.request.patch(`/api/campaigns/${CAMPAIGN_ID}`, {
      data: { displayName: original },
    })
    expect(restored.status()).toBe(200)
  }
  await page.goto('/d/coupang-ads')
  await expect(card.getByText(original, { exact: true })).toBeVisible()
})
