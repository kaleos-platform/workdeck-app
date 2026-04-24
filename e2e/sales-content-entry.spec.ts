import { test, expect } from '@playwright/test'

test.describe('Sales Content Deck 진입', () => {
  test('비로그인 /d/sales-content → 덱 로그인 페이지로 리다이렉트', async ({ page }) => {
    const response = await page.goto('/d/sales-content')
    expect(response?.status()).toBeLessThan(400)
    await expect(page).toHaveURL(/\/d\/sales-content\/login/)
    await expect(page.getByText('Workdeck 로그인', { exact: false }).first()).toBeVisible()
    await expect(page.getByText(/세일즈 콘텐츠/)).toBeVisible()
  })

  test('비로그인 /d/sales-content/home → 일반 로그인 리다이렉트 (redirectTo 포함)', async ({
    page,
  }) => {
    await page.goto('/d/sales-content/home')
    await expect(page).toHaveURL(/\/login\?redirectTo=/)
  })

  test('존재하지 않는 deckKey /d/unknown-deck → 일반 로그인 리다이렉트 후 deck 로그인 404 없음', async ({
    page,
  }) => {
    const response = await page.goto('/d/unknown-deck/login')
    // DECK_COPY에도 없고 DB에도 없으면 notFound → 404
    expect(response?.status()).toBe(404)
  })

  test('비로그인 /d/seller-hub → 덱 로그인 페이지 정상 노출', async ({ page }) => {
    await page.goto('/d/seller-hub')
    await expect(page).toHaveURL(/\/d\/seller-hub\/login/)
    await expect(page.getByText(/셀러 허브/)).toBeVisible()
  })
})
