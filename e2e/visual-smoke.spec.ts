import { test, expect } from '@playwright/test'

// UI 스모크(비차단): 로그인 없는 화면만 스크린샷 비교 + axe(serious·critical).
// 기준 스크린샷은 CI와 같은 이미지(mcr.microsoft.com/playwright:v1.58.2-jammy)에서 만든다:
//   docker run --rm --ipc=host -v "$PWD":/work -w /work -e CI=1 \
//     -e PLAYWRIGHT_BASE_URL=http://host.docker.internal:<port> \
//     mcr.microsoft.com/playwright:v1.58.2-jammy npx playwright test e2e/visual-smoke.spec.ts --update-snapshots
// axe-core는 eslint-plugin-jsx-a11y가 가져온 의존성(새 패키지 추가 없음)
const AXE = require.resolve('axe-core/axe.min.js')

const PAGES = ['/login', '/signup']

for (const path of PAGES) {
  test(`visual ${path}`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot(`${path.slice(1)}.png`, {
      fullPage: true,
      animations: 'disabled',
    })

    await page.addScriptTag({ path: AXE })
    const violations = await page.evaluate(async () => {
      // @ts-expect-error axe는 위 addScriptTag로 주입된다
      const result = await window.axe.run(document, { resultTypes: ['violations'] })
      return result.violations
        .filter((v: { impact?: string }) => v.impact === 'serious' || v.impact === 'critical')
        .map(
          (v: { id: string; impact?: string; nodes: unknown[] }) =>
            `${v.id}(${v.impact}) x${v.nodes.length}`
        )
    })
    expect(violations, `axe serious/critical on ${path}`).toEqual([])
  })
}
