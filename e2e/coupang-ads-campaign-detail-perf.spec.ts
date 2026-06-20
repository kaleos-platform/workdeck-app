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
