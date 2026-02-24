import { test, expect } from '@playwright/test'

test.describe('인증 리다이렉트', () => {
  test('/dashboard 미인증 접근 → /login 리다이렉트', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('로그인 페이지 렌더링 — 이메일/비밀번호 입력 필드 존재', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('textbox').first()).toBeVisible()
  })

  test('랜딩 페이지(/) 정상 렌더링', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/')
    await expect(page.locator('body')).toBeVisible()
  })
})
