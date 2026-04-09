/**
 * 쿠팡 Wing 재고 데이터 수집기
 *
 * 흐름:
 * 1. Wing 로그인 (기존 쿠팡 계정 사용)
 * 2. 재고 건강성 페이지 → 엑셀 다운로드
 * 3. 판매 성과(Vendor Item Metrics) 페이지 → 엑셀 다운로드
 *
 * 기존 collector.ts의 브라우저 컨텍스트를 재사용하여
 * 광고 데이터 수집 후 같은 세션에서 실행된다.
 */

import fs from 'node:fs'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'

// ─── 타입 ────────────────────────────────────────────────────────────────────────

export interface InventoryCollectorResult {
  inventoryHealth: { filePath: string; fileName: string } | null
  vendorMetrics: { filePath: string; fileName: string } | null
}

// ─── 상수 ────────────────────────────────────────────────────────────────────────

const WING_URL = 'https://wing.coupang.com'
const INVENTORY_HEALTH_URL = `${WING_URL}/tenants/rfm-inventory/management/list`
const VENDOR_METRICS_URL = `${WING_URL}/tenants/seller-insights/vendor-item-metrics`
const SCREENSHOT_DIR = path.resolve('.screenshots')
const DEFAULT_TIMEOUT = 30_000
const DOWNLOAD_TIMEOUT = 120_000

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────────

async function saveScreenshot(page: Page, name: string): Promise<void> {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const fileName = `${name}_${new Date().toISOString().replace(/[:.]/g, '-')}.png`
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, fileName), fullPage: true })
  console.log(`[inventory] 스크린샷: ${fileName}`)
}

/** Wing에 로그인되어 있는지 확인 */
async function isWingLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto(`${WING_URL}/dashboard`, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT,
    })
    await page.waitForTimeout(2000)
    const url = page.url()
    return !url.includes('login') && !url.includes('sso') && url.includes('wing.coupang.com')
  } catch {
    return false
  }
}

/** Wing 로그인 수행 */
async function performWingLogin(
  page: Page,
  credentials: { loginId: string; password: string },
): Promise<void> {
  console.log('[inventory] Wing 로그인 시도...')
  await page.goto(`${WING_URL}/login`, {
    waitUntil: 'domcontentloaded',
    timeout: DEFAULT_TIMEOUT,
  })
  await page.waitForTimeout(2000)

  // ID 입력
  const idSelectors = ['input[name="username"]', 'input[name="id"]', 'input[type="text"]']
  for (const sel of idSelectors) {
    const el = page.locator(sel).first()
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.fill(credentials.loginId)
      console.log(`[inventory]   → ID 입력 (${sel})`)
      break
    }
  }

  // PW 입력
  await page.locator('input[type="password"]').first().fill(credentials.password)

  // 로그인 버튼
  const loginBtn = page
    .locator('button[type="submit"], button:has-text("로그인"), input[type="submit"]')
    .first()
  await loginBtn.waitFor({ timeout: 10000 })
  await loginBtn.click()
  await page.waitForTimeout(5000)

  if (page.url().includes('login') || page.url().includes('sso')) {
    await saveScreenshot(page, 'wing-login-failed')
    throw new Error('[inventory] Wing 로그인 실패')
  }
  console.log('[inventory]   → Wing 로그인 성공')
}

// ─── 다운로드 함수 ──────────────────────────────────────────────────────────────

/**
 * 페이지에서 엑셀 다운로드 버튼을 클릭하고 파일을 저장한다.
 * download 이벤트 프로미스를 안전하게 관리하여 unhandled rejection을 방지한다.
 */
async function clickAndDownload(
  page: Page,
  downloadDir: string,
  btnLocator: ReturnType<Page['locator']>,
  fallbackName: string,
): Promise<{ filePath: string; fileName: string }> {
  // download 이벤트 리스너를 먼저 등록
  const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT })
  // 실패 시 프로미스가 unhandled rejection 되지 않도록 catch 등록
  downloadPromise.catch(() => {})

  await btnLocator.click()

  const download = await downloadPromise
  const fileName = download.suggestedFilename() || fallbackName
  const filePath = path.join(downloadDir, fileName)
  await download.saveAs(filePath)
  return { filePath, fileName }
}

/** 재고 건강성 엑셀 다운로드 */
async function downloadInventoryHealth(
  page: Page,
  downloadDir: string,
): Promise<{ filePath: string; fileName: string }> {
  console.log('[inventory] 재고 건강성 페이지 이동...')
  await page.goto(INVENTORY_HEALTH_URL, {
    waitUntil: 'domcontentloaded',
    timeout: DEFAULT_TIMEOUT,
  })
  await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(3000)
  await saveScreenshot(page, 'inventory-health-page')

  // 페이지의 "엑셀" 또는 "다운" 포함 버튼 텍스트 로깅 (디버깅용)
  const excelBtnTexts = await page.evaluate(() => {
    const els = document.querySelectorAll('button, a, [role="button"], span, div[class*="btn"], div[class*="button"]')
    return Array.from(els)
      .map((el) => ({ text: el.textContent?.trim(), tag: el.tagName, cls: el.className?.toString().slice(0, 60) }))
      .filter((t) => t.text && (t.text.includes('엑셀') || t.text.includes('다운')) && t.text.length < 80)
  })
  console.log(`[inventory]   → 엑셀/다운 관련 요소: ${JSON.stringify(excelBtnTexts)}`)

  // "재고" + "엑셀" 또는 "다운" 텍스트를 가진 버튼 우선, 없으면 "엑셀" 포함 버튼
  let downloadBtn = page
    .locator('button:has-text("재고"), a:has-text("재고"), [role="button"]:has-text("재고")')
    .filter({ hasText: /엑셀|다운/ })
    .first()

  if (!(await downloadBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    // fallback: 페이지 컨텐츠 영역에서 "엑셀" 포함 버튼 (사이드바 제외)
    downloadBtn = page
      .locator('#content button:has-text("엑셀"), #content a:has-text("엑셀"), main button:has-text("엑셀"), main a:has-text("엑셀"), .content button:has-text("엑셀"), .content a:has-text("엑셀")')
      .first()
  }

  if (!(await downloadBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    // 마지막 fallback: 모든 "엑셀" 버튼 중 "상품목록"이 아닌 것
    const allExcelBtns = page.locator('button:has-text("엑셀"), a:has-text("엑셀")')
    const count = await allExcelBtns.count()
    console.log(`[inventory]   → "엑셀" 포함 버튼 ${count}개`)
    for (let i = 0; i < count; i++) {
      const text = await allExcelBtns.nth(i).textContent().catch(() => '')
      console.log(`[inventory]     [${i}] "${text?.trim()}"`)
      // "상품목록"은 건너뛰고, "재고" 또는 "다운" 포함된 것 선택
      if (text && !text.includes('상품목록') && (text.includes('재고') || text.includes('다운'))) {
        downloadBtn = allExcelBtns.nth(i)
        break
      }
    }
  }

  if (!(await downloadBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    await saveScreenshot(page, 'inventory-health-no-btn')
    throw new Error('[inventory] 재고 건강성 다운로드 버튼을 찾을 수 없습니다')
  }

  const btnText = await downloadBtn.textContent().catch(() => '?')
  console.log(`[inventory]   → 다운로드 버튼 텍스트: "${btnText?.trim()}"`)

  // Step 1: "엑셀 다운로드" 클릭 → 서버에 생성 요청
  console.log('[inventory]   → 엑셀 생성 요청 클릭')
  await downloadBtn.click()
  await page.waitForTimeout(3000)
  await saveScreenshot(page, 'inventory-health-after-click')

  // Step 2: 다운로드 내역에서 "다운로드" 버튼이 나타날 때까지 대기 (최대 60초)
  // Wing은 "엑셀 다운로드" 클릭 → 서버 생성 → 내역 목록에 "다운로드" 버튼 표시 패턴
  console.log('[inventory]   → 다운로드 내역에서 파일 대기...')
  const dlBtn = page.locator('button:text-is("다운로드")').first()

  for (let i = 0; i < 20; i++) {
    if (await dlBtn.isVisible().catch(() => false)) {
      console.log(`[inventory]   → 다운로드 버튼 발견 (${(i + 1) * 3}초)`)
      break
    }
    await page.waitForTimeout(3000)
    if (i % 5 === 4) {
      await saveScreenshot(page, `inventory-health-waiting-${i}`)
      console.log(`[inventory]   → 대기 중... (${(i + 1) * 3}초)`)
    }
  }

  if (!(await dlBtn.isVisible().catch(() => false))) {
    await saveScreenshot(page, 'inventory-health-no-dl-btn')
    throw new Error('[inventory] 재고 건강성 다운로드 내역에 다운로드 버튼이 나타나지 않음')
  }

  // Step 3: "다운로드" 버튼 클릭 → 실제 파일 다운로드
  const result = await clickAndDownload(
    page,
    downloadDir,
    dlBtn,
    `inventory_health_${Date.now()}.xlsx`,
  )

  console.log(`[inventory]   → 재고 건강성 저장: ${result.fileName}`)
  return result
}

/** 판매 성과 (Vendor Item Metrics) 엑셀 다운로드 */
async function downloadVendorMetrics(
  page: Page,
  downloadDir: string,
): Promise<{ filePath: string; fileName: string }> {
  console.log('[inventory] 판매 성과 페이지 이동...')
  await page.goto(VENDOR_METRICS_URL, {
    waitUntil: 'domcontentloaded',
    timeout: DEFAULT_TIMEOUT,
  })
  await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(3000)
  await saveScreenshot(page, 'vendor-metrics-page')

  // 엑셀 다운로드 버튼 찾기
  const downloadBtn = page
    .locator(
      'button:has-text("엑셀 다운로드"), a:has-text("엑셀 다운로드"), button:has-text("다운로드"), a:has-text("다운로드")',
    )
    .first()

  if (!(await downloadBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
    await saveScreenshot(page, 'vendor-metrics-no-btn')
    throw new Error('[inventory] 판매 성과 다운로드 버튼을 찾을 수 없습니다')
  }

  console.log('[inventory]   → 다운로드 시작')
  const result = await clickAndDownload(
    page,
    downloadDir,
    downloadBtn,
    `vendor_metrics_${Date.now()}.xlsx`,
  )

  console.log(`[inventory]   → 판매 성과 저장: ${result.fileName}`)
  return result
}

// ─── 메인 함수 ──────────────────────────────────────────────────────────────────

/**
 * Wing에서 재고 데이터를 수집한다.
 * 광고센터 수집 후 같은 .browser-data를 사용하는 새 컨텍스트를 열어
 * 쿠팡 SSO 세션을 공유한다. 수집 후 컨텍스트를 닫는다.
 */
export async function collectInventoryData(
  credentials: { loginId: string; password: string },
  options: {
    downloadDir?: string
    browserDataDir?: string
    headless?: boolean
  } = {},
): Promise<InventoryCollectorResult> {
  const {
    downloadDir = path.resolve('.downloads'),
    browserDataDir = process.env.COUPANG_BROWSER_DATA_DIR || '.browser-data',
    headless = process.env.HEADLESS !== 'false',
  } = options

  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })

  console.log('[inventory] 브라우저 실행 (Wing 재고 수집)')
  const context: BrowserContext = await chromium.launchPersistentContext(
    path.resolve(browserDataDir),
    {
      headless,
      acceptDownloads: true,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      viewport: { width: 1400, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  )

  const page = context.pages()[0] || (await context.newPage())

  try {
    // Wing 로그인 확인
    console.log('\n[inventory] Wing 로그인 확인...')
    if (!(await isWingLoggedIn(page))) {
      await performWingLogin(page, credentials)
    } else {
      console.log('[inventory]   → 기존 Wing 세션 유지')
    }

    let inventoryHealth: { filePath: string; fileName: string } | null = null
    let vendorMetrics: { filePath: string; fileName: string } | null = null

    // 재고 건강성 다운로드
    try {
      inventoryHealth = await downloadInventoryHealth(page, downloadDir)
    } catch (err) {
      console.error(
        '[inventory] 재고 건강성 다운로드 실패:',
        err instanceof Error ? err.message : err,
      )
      await saveScreenshot(page, 'inventory-health-error')
    }

    // 판매 성과 다운로드
    try {
      vendorMetrics = await downloadVendorMetrics(page, downloadDir)
    } catch (err) {
      console.error(
        '[inventory] 판매 성과 다운로드 실패:',
        err instanceof Error ? err.message : err,
      )
      await saveScreenshot(page, 'vendor-metrics-error')
    }

    return { inventoryHealth, vendorMetrics }
  } catch (error) {
    await saveScreenshot(page, 'inventory-error')
    throw error
  } finally {
    await context.close()
  }
}
