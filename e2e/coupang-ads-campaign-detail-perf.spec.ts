import { expect, Page, test } from '@playwright/test'

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
      const link = await home(() => page.goto('/d/coupang-ads'), 'first')
      await detail(() => link.click(), 'detail')
      const revisitLink = await home(
        () => page.locator('a[href="/d/coupang-ads"]').first().click(),
        'revisit'
      )
      await detail(() => revisitLink.click(), 'detail_revisit')
    }
  } finally {
    await testInfo.attach('coupang-ads-performance.json', {
      body: JSON.stringify(samples, null, 2),
      contentType: 'application/json',
    })
  }
  for (const sample of samples) {
    expect
      .soft(sample.ms, `${sample.screen}: ${sample.ms.toFixed(0)}ms`)
      .toBeLessThanOrEqual(sample.screen.includes('revisit') ? 1000 : 3000)
  }
})
