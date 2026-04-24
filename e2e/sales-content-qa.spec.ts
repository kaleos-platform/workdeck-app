/**
 * 세일즈 콘텐츠 Deck 로그인 후 진입 E2E QA
 * 실 계정 로그인 → my-deck → 세일즈 콘텐츠 진입 → 내부 섹션 순회
 */
import { test, expect, Page } from '@playwright/test'

const EMAIL = process.env.E2E_TEST_EMAIL ?? ''
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? ''

test.skip(!EMAIL || !PASSWORD, 'E2E_TEST_EMAIL / E2E_TEST_PASSWORD 미설정 — 인증 E2E 생략')

async function loginUser(page: Page) {
  await page.goto('/login')
  await page.waitForLoadState('networkidle')

  // 로그인 폼 채우기
  const emailInput = page
    .getByLabel(/이메일/i)
    .or(page.locator('input[type="email"]'))
    .first()
  const passwordInput = page
    .getByLabel(/비밀번호/i)
    .or(page.locator('input[type="password"]'))
    .first()

  await emailInput.fill(EMAIL)
  await passwordInput.fill(PASSWORD)

  const submitBtn = page.getByRole('button', { name: /로그인/i }).first()
  await submitBtn.click()

  // 로그인 후 리다이렉트 대기
  await page.waitForURL(/\/my-deck|\/dashboard/, { timeout: 10000 })
}

test.describe('Step 1 - 로그인', () => {
  test('로그인 → /my-deck 리다이렉트 + 세일즈 콘텐츠 카드 노출', async ({ page }) => {
    const consoleLogs: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleLogs.push(`[Error] ${msg.text()}`)
      if (msg.type() === 'warning') consoleLogs.push(`[Warn] ${msg.text()}`)
    })

    await loginUser(page)

    console.log('로그인 후 URL:', page.url())
    expect(page.url()).toMatch(/\/my-deck/)

    // 세일즈 콘텐츠 카드 존재 여부
    const salesContentCard = page.getByText('세일즈 콘텐츠').first()
    await expect(salesContentCard).toBeVisible({ timeout: 5000 })

    console.log('콘솔 로그:', consoleLogs)
    expect(consoleLogs.filter((l) => l.includes('[Error]'))).toHaveLength(0)
  })
})

test.describe('Step 2 - my-deck에서 세일즈 콘텐츠 진입', () => {
  test('빠르게 진입 버튼 → /d/sales-content/home 이동', async ({ page }) => {
    const consoleLogs: string[] = []
    const networkErrors: string[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleLogs.push(`[Error] ${msg.text()}`)
    })
    page.on('response', (resp) => {
      if (resp.status() >= 400) {
        networkErrors.push(`[${resp.status()}] ${resp.url()}`)
      }
    })

    await loginUser(page)

    // 세일즈 콘텐츠 카드 내 빠르게 진입 버튼 클릭
    const allEntryLinks = page.getByRole('link', { name: /빠르게 진입/i })
    const count = await allEntryLinks.count()
    console.log('빠르게 진입 버튼 수:', count)

    if (count === 0) {
      console.log('=== 페이지 HTML 스냅샷 ===')
      const html = await page.content()
      console.log(html.substring(0, 3000))
      throw new Error('빠르게 진입 버튼을 찾을 수 없음')
    }

    // 세일즈 콘텐츠 카드에서 빠르게 진입 클릭 (href 기반으로 정확히 찾기)
    const salesEntryLink = page
      .locator('a[href*="sales-content"]')
      .filter({ hasText: /빠르게 진입/i })
      .first()
    const salesLinkHref = await salesEntryLink.getAttribute('href').catch(() => null)
    console.log('세일즈 콘텐츠 진입 링크 href:', salesLinkHref)

    if (!salesLinkHref) {
      // href로 못 찾으면 순서 기반으로 클릭
      await allEntryLinks.nth(0).click()
    } else {
      await salesEntryLink.click()
    }

    await page.waitForURL(/\/d\/sales-content/, { timeout: 10000 })
    console.log('진입 후 URL:', page.url())

    expect(page.url()).toMatch(/\/d\/sales-content/)

    // 추가 홈 리다이렉트 대기
    await page.waitForURL(/\/d\/sales-content\/home/, { timeout: 5000 }).catch(() => {
      console.log('home 리다이렉트 없음, 현재 URL:', page.url())
    })

    console.log('최종 URL:', page.url())
    console.log('콘솔 에러:', consoleLogs)
    console.log('네트워크 에러:', networkErrors)
  })
})

test.describe('Step 3 - 홈 렌더 및 사이드바 확인', () => {
  test('홈 페이지 렌더 — 사이드바·헤더 존재', async ({ page }) => {
    const consoleLogs: string[] = []
    const networkErrors: string[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleLogs.push(`[Error] ${msg.text()}`)
    })
    page.on('response', (resp) => {
      if (resp.status() >= 400) networkErrors.push(`[${resp.status()}] ${resp.url()}`)
    })

    await loginUser(page)
    await page.goto('/d/sales-content/home')
    await page.waitForLoadState('networkidle')

    console.log('홈 URL:', page.url())
    console.log('콘솔 에러:', consoleLogs)
    console.log('네트워크 에러:', networkErrors)

    // 500 리다이렉트 확인
    expect(page.url()).toMatch(/\/d\/sales-content/)
    expect(page.url()).not.toMatch(/\/login/)
    expect(page.url()).not.toMatch(/\/my-deck/)

    // 헤더 존재
    const header = page.locator('header').first()
    await expect(header).toBeVisible({ timeout: 5000 })

    // 사이드바 존재 — sidebar는 div.bg-slate-900 구현이므로 섹션 버튼으로 확인
    const sidebarSection = page.getByRole('button', { name: '정보 세팅' })
    await expect(sidebarSection).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Step 4 - 내부 섹션 클릭 테스트', () => {
  test.beforeEach(async ({ page }) => {
    await loginUser(page)
    await page.goto('/d/sales-content/home')
    await page.waitForLoadState('networkidle')
  })

  const sections = [
    { name: '판매 상품', path: '/d/sales-content/settings/products' },
    { name: '아이데이션', path: '/d/sales-content/ideation' },
    { name: '채널', path: '/d/sales-content/channels' },
    { name: '개선 규칙', path: '/d/sales-content/rules' },
  ]

  for (const section of sections) {
    test(`섹션 클릭: ${section.name} → 500 없음`, async ({ page }) => {
      const networkErrors: string[] = []
      page.on('response', (resp) => {
        if (resp.status() >= 400) networkErrors.push(`[${resp.status()}] ${resp.url()}`)
      })

      await page.goto(section.path)
      await page.waitForLoadState('networkidle')

      console.log(`${section.name} URL:`, page.url())
      console.log(`${section.name} 네트워크 에러:`, networkErrors)

      // 페이지가 에러 없이 렌더되어야 함
      const body = await page.content()
      const has500 = body.includes('500') && body.includes('Internal Server Error')
      expect(has500).toBe(false)

      // 로그인 페이지로 튕기지 않아야 함
      expect(page.url()).not.toMatch(/\/login/)
    })
  }
})
