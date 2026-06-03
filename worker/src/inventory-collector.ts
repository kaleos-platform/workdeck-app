/**
 * 쿠팡 Wing 재고 데이터 수집기
 *
 * 흐름:
 * 1. Wing 로그인 (기존 쿠팡 계정 사용)
 * 2. 재고현황 페이지 → 엑셀 다운로드
 *
 * 기존 collector.ts의 브라우저 컨텍스트를 재사용하여
 * 광고 데이터 수집 후 같은 세션에서 실행된다.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import { launchStealthPersistentContext } from './browser.js'

// ─── 타입 ────────────────────────────────────────────────────────────────────────

export interface InventoryCollectorResult {
  inventoryHealth: { filePath: string; fileName: string } | null
  /** 재고 다운로드 단계가 실패했을 때의 오류 메시지. 성공이면 undefined. */
  inventoryHealthError?: string
  /** 판매분석(상품별/VENDOR) 다운로드 결과. 성공이면 파일 경로. */
  salesVendor?: { filePath: string; fileName: string } | null
  /** 판매분석 다운로드 단계가 실패했을 때의 오류 메시지. 성공이면 undefined. */
  salesVendorError?: string
}

// ─── 상수 ────────────────────────────────────────────────────────────────────────

const WING_URL = 'https://wing.coupang.com'
const INVENTORY_HEALTH_URL = `${WING_URL}/tenants/rfm-inventory/management/list`
const SALES_ANALYSIS_URL = `${WING_URL}/tenants/business-insight/sales-analysis`
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
  credentials: { loginId: string; password: string }
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
 * 페이지에서 다운로드를 트리거하고 파일을 저장한다.
 * download 이벤트 프로미스를 안전하게 관리하여 unhandled rejection을 방지한다.
 */
async function clickAndDownload(
  page: Page,
  downloadDir: string,
  btnLocator: ReturnType<Page['locator']>,
  fallbackName: string
): Promise<{ filePath: string; fileName: string }> {
  const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT })
  downloadPromise.catch(() => {})

  await btnLocator.click({ force: true })

  const download = await downloadPromise
  const fileName = download.suggestedFilename() || fallbackName
  const filePath = path.join(downloadDir, fileName)
  await download.saveAs(filePath)
  return { filePath, fileName }
}

/** 페이지에 떠 있는 공지/프로모션 모달을 모두 닫는다 */
async function dismissModals(page: Page): Promise<boolean> {
  let dismissed = false
  const dismissCandidates = [
    'button:has-text("닫기")',
    'button:has-text("오늘 하루 보지 않기")',
    'button:has-text("나중에")',
    'button:has-text("다음에")',
    'button[aria-label="닫기"]',
    'button[aria-label="Close"]',
    '[data-wuic-partial="close"]',
    // 일반적인 모달 우상단 X 버튼
    '.modal-close',
    '.dialog-close',
    '[class*="close"][role="button"]',
  ]
  for (const sel of dismissCandidates) {
    const btn = page.locator(sel).first()
    if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
      await btn.click({ force: true }).catch(() => {})
      dismissed = true
      await page.waitForTimeout(400)
    }
  }

  // 쿠팡 Wing 재고현황 신규 가이드 모달: X 아이콘이 button이 아닌 div/span으로 렌더링된다.
  const guideTitle = page.locator('text=더 고도화된 재고현황').first()
  if (await guideTitle.isVisible({ timeout: 800 }).catch(() => false)) {
    const modalBox = await guideTitle
      .evaluate((node) => {
        let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement
        while (el) {
          const rect = el.getBoundingClientRect()
          if (rect.width >= 320 && rect.height >= 220) {
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          }
          el = el.parentElement
        }
        return null
      })
      .catch(() => null)

    if (modalBox) {
      await page.mouse.click(modalBox.x + modalBox.width - 24, modalBox.y + 24).catch(() => {})
      await page.waitForTimeout(500)
    }

    if (await guideTitle.isVisible({ timeout: 500 }).catch(() => false)) {
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(500)
    }

    dismissed = true
  }

  return dismissed
}

/** 사이드바 기준으로 로켓그로스 > 재고현황 진입 */
async function navigateToRocketGrowthInventory(page: Page): Promise<void> {
  console.log('[inventory] Wing 재고현황 페이지 진입...')

  await page.goto(`${WING_URL}/dashboard`, {
    waitUntil: 'domcontentloaded',
    timeout: DEFAULT_TIMEOUT,
  })
  await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(2000)

  await dismissModals(page)

  const rocketGrowth = page.locator('text=로켓그로스').first()
  if (await rocketGrowth.isVisible({ timeout: 5000 }).catch(() => false)) {
    await rocketGrowth.click({ force: true }).catch(() => {})
    await page.waitForTimeout(1000)
  }

  const inventoryMenu = page
    .locator('a:has-text("재고현황"), button:has-text("재고현황"), text=재고현황')
    .first()
  if (await inventoryMenu.isVisible({ timeout: 5000 }).catch(() => false)) {
    await inventoryMenu.click({ force: true })
  } else {
    console.log('[inventory]   → 사이드바 경로 실패, 직접 URL fallback')
    await page.goto(INVENTORY_HEALTH_URL, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT,
    })
  }

  await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(3000)

  // 재고현황 페이지에서 프로모션 모달이 또 뜰 수 있음 — 한 번 더 닫기
  await dismissModals(page)
  await page.waitForTimeout(500)

  await saveScreenshot(page, 'inventory-health-page')
}

/** 재고현황 엑셀 다운로드 */
async function downloadInventoryHealth(
  page: Page,
  downloadDir: string
): Promise<{ filePath: string; fileName: string }> {
  await navigateToRocketGrowthInventory(page)

  let downloadBtn = page.locator('.excel_download button:has-text("엑셀 다운로드")').first()
  if (!(await downloadBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    downloadBtn = page.locator('button:has-text("엑셀 다운로드")').first()
  }

  if (!(await downloadBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    await saveScreenshot(page, 'inventory-health-no-btn')
    throw new Error('[inventory] 재고현황의 "엑셀 다운로드" 버튼을 찾을 수 없습니다')
  }

  console.log('[inventory]   → 재고현황 엑셀 다운로드 메뉴 열기')
  await downloadBtn.click({ force: true })
  await page.waitForTimeout(1000)

  // 버튼 클릭 타이밍에 신규 가이드 모달이 늦게 뜨면 드롭다운이 열리지 않는다.
  // 모달을 닫은 뒤 다운로드 버튼을 한 번만 다시 클릭한다.
  let requestBtn = page.locator('text=엑셀 다운로드 요청').first()
  if (await dismissModals(page)) {
    await page.waitForTimeout(500)
    const isMenuAlreadyOpen = await requestBtn.isVisible({ timeout: 1000 }).catch(() => false)
    if (!isMenuAlreadyOpen) {
      await downloadBtn.click({ force: true })
      await page.waitForTimeout(1000)
    }
  }

  await saveScreenshot(page, 'inventory-health-menu-open')
  if (!(await requestBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    requestBtn = page.locator('.backdrop div:has-text("엑셀 다운로드 요청")').first()
  }
  if (!(await requestBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    requestBtn = page
      .locator(
        'div[role="menuitem"]:has-text("엑셀 다운로드 요청"), li:has-text("엑셀 다운로드 요청")'
      )
      .first()
  }

  if (!(await requestBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    await saveScreenshot(page, 'inventory-health-no-request-btn')
    throw new Error('[inventory] 재고현황의 "엑셀 다운로드 요청" 메뉴를 찾을 수 없습니다')
  }

  const menuText = (await requestBtn.textContent().catch(() => ''))?.trim()
  console.log(`[inventory]   → 메뉴 선택: ${menuText}`)
  const result = await clickAndDownload(
    page,
    downloadDir,
    requestBtn,
    `inventory_health_${Date.now()}.xlsx`
  )

  console.log(`[inventory]   → 재고현황 저장: ${result.fileName}`)
  return result
}

/**
 * 판매분석 > 상품별(VENDOR) 엑셀 다운로드
 *
 * targetDateKst: 'YYYY-MM-DD' 형식의 KST 날짜 (어제). 기간 필터를 1일로 지정한다.
 *
 * 셀렉터 주의:
 *   - 날짜 입력/선택 UI는 실제 DOM 확인 전까지 추정값이다.
 *     각 단계마다 saveScreenshot을 남겨 QA 시 확인할 수 있도록 한다.
 *   - "// TODO: 실제 DOM 확인 필요" 주석이 있는 지점은 운영 전 Playwright 인스펙터로 검증 필요.
 */
async function downloadSalesAnalysisVendor(
  page: Page,
  downloadDir: string,
  targetDateKst: string
): Promise<{ filePath: string; fileName: string }> {
  console.log(`[inventory] 판매분석(VENDOR) 페이지 진입... (대상 날짜: ${targetDateKst})`)

  await page.goto(SALES_ANALYSIS_URL, {
    waitUntil: 'domcontentloaded',
    timeout: DEFAULT_TIMEOUT,
  })
  await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(3000)

  await dismissModals(page)
  await saveScreenshot(page, 'sales-analysis-loaded')

  // ── 날짜 필터: 시작일 = 종료일 = targetDateKst (1일치) ──────────────────────
  // TODO: 실제 DOM 확인 필요 — 날짜 입력 필드 셀렉터는 추정값.
  // Wing 판매분석 날짜 picker는 input[type="text"] 또는 .date-input 계열이 일반적.
  const dateInputSelectors = [
    'input[placeholder*="시작일"]',
    'input[placeholder*="조회시작"]',
    '.date-picker input:first-child',
    'input[data-role="startDate"]',
    // TODO: 실제 DOM 확인 필요 — 위 셀렉터가 모두 실패하면 아래 fallback 시도
    '.date-range-picker input:first-of-type',
    'input[type="text"]:first-of-type',
  ]

  let startInputFilled = false
  for (const sel of dateInputSelectors) {
    const el = page.locator(sel).first()
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      await el.click({ clickCount: 3 }).catch(() => {})
      await el.fill(targetDateKst).catch(() => {})
      console.log(`[inventory]   → 시작일 입력 (${sel}): ${targetDateKst}`)
      startInputFilled = true
      break
    }
  }

  if (!startInputFilled) {
    await saveScreenshot(page, 'sales-analysis-no-start-date-input')
    console.warn('[inventory]   ⚠ 시작일 입력 필드를 찾지 못했습니다 — TODO: 실제 셀렉터 확인 필요')
  }

  await page.waitForTimeout(500)

  // 종료일 입력
  // TODO: 실제 DOM 확인 필요 — 종료일 셀렉터 추정값
  const endInputSelectors = [
    'input[placeholder*="종료일"]',
    'input[placeholder*="조회종료"]',
    '.date-picker input:last-child',
    'input[data-role="endDate"]',
    '.date-range-picker input:last-of-type',
  ]

  let endInputFilled = false
  for (const sel of endInputSelectors) {
    const el = page.locator(sel).first()
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      await el.click({ clickCount: 3 }).catch(() => {})
      await el.fill(targetDateKst).catch(() => {})
      console.log(`[inventory]   → 종료일 입력 (${sel}): ${targetDateKst}`)
      endInputFilled = true
      break
    }
  }

  if (!endInputFilled) {
    await saveScreenshot(page, 'sales-analysis-no-end-date-input')
    console.warn('[inventory]   ⚠ 종료일 입력 필드를 찾지 못했습니다 — TODO: 실제 셀렉터 확인 필요')
  }

  await page.waitForTimeout(500)

  // 조회/검색 버튼 클릭
  // TODO: 실제 DOM 확인 필요 — 조회 버튼 텍스트/셀렉터 추정값
  const searchBtnSelectors = [
    'button:has-text("조회")',
    'button:has-text("검색")',
    'button[type="submit"]:has-text("조회")',
    '.search-btn',
    '[data-wuic-partial="search"]',
  ]

  let searchClicked = false
  for (const sel of searchBtnSelectors) {
    const btn = page.locator(sel).first()
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click({ force: true })
      console.log(`[inventory]   → 조회 버튼 클릭 (${sel})`)
      searchClicked = true
      break
    }
  }

  if (!searchClicked) {
    // Enter 키 fallback
    await page.keyboard.press('Enter').catch(() => {})
    console.warn(
      '[inventory]   ⚠ 조회 버튼을 찾지 못해 Enter 키로 대체 — TODO: 실제 셀렉터 확인 필요'
    )
  }

  await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(3000)
  await dismissModals(page)
  await saveScreenshot(page, 'sales-analysis-after-search')

  // ── 엑셀 다운로드 버튼 ──────────────────────────────────────────────────────
  // TODO: 실제 DOM 확인 필요 — 상위 "엑셀 다운로드" 버튼 셀렉터
  let excelMainBtn = page.locator('.excel_download button:has-text("엑셀 다운로드")').first()
  if (!(await excelMainBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    excelMainBtn = page.locator('button:has-text("엑셀 다운로드")').first()
  }

  if (!(await excelMainBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    await saveScreenshot(page, 'sales-analysis-no-excel-btn')
    throw new Error(
      '[inventory] 판매분석의 "엑셀 다운로드" 버튼을 찾을 수 없습니다 — TODO: 실제 셀렉터 확인 필요'
    )
  }

  console.log('[inventory]   → 판매분석 엑셀 다운로드 메뉴 열기')
  await excelMainBtn.click({ force: true })
  await page.waitForTimeout(1000)

  // 모달이 늦게 뜨면 드롭다운이 닫힐 수 있으므로 dismissModals 후 재시도
  // TODO: 실제 DOM 확인 필요 — "상품별 엑셀 다운로드" 메뉴 항목 텍스트 추정값
  let vendorMenuBtn = page.locator('text=상품별 엑셀 다운로드').first()
  if (await dismissModals(page)) {
    await page.waitForTimeout(500)
    const isMenuOpen = await vendorMenuBtn.isVisible({ timeout: 1000 }).catch(() => false)
    if (!isMenuOpen) {
      await excelMainBtn.click({ force: true })
      await page.waitForTimeout(1000)
    }
  }

  await saveScreenshot(page, 'sales-analysis-excel-menu-open')

  // fallback 셀렉터들
  if (!(await vendorMenuBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    vendorMenuBtn = page.locator('.backdrop div:has-text("상품별 엑셀 다운로드")').first()
  }
  if (!(await vendorMenuBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    vendorMenuBtn = page
      .locator(
        'div[role="menuitem"]:has-text("상품별 엑셀 다운로드"), li:has-text("상품별 엑셀 다운로드")'
      )
      .first()
  }
  // TODO: 실제 DOM 확인 필요 — 메뉴 텍스트가 "상품별" 이 아닌 경우 대비 (예: "VENDOR", "아이템별" 등)
  if (!(await vendorMenuBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    vendorMenuBtn = page
      .locator('div[role="menuitem"]:has-text("상품"), li:has-text("상품")')
      .first()
  }

  if (!(await vendorMenuBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    await saveScreenshot(page, 'sales-analysis-no-vendor-menu')
    throw new Error(
      '[inventory] 판매분석의 "상품별 엑셀 다운로드" 메뉴를 찾을 수 없습니다 — TODO: 실제 DOM 확인 필요'
    )
  }

  const menuText = (await vendorMenuBtn.textContent().catch(() => ''))?.trim()
  console.log(`[inventory]   → 메뉴 선택: ${menuText}`)

  const result = await clickAndDownload(
    page,
    downloadDir,
    vendorMenuBtn,
    `sales_vendor_${Date.now()}.xlsx`
  )

  console.log(`[inventory]   → 판매분석(VENDOR) 저장: ${result.fileName}`)
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
    /** 판매분석 수집 대상 날짜 (KST YYYY-MM-DD). 미지정 시 판매분석 수집 생략. */
    targetDateKst?: string
  } = {}
): Promise<InventoryCollectorResult> {
  const {
    downloadDir = path.resolve('.downloads'),
    browserDataDir = process.env.COUPANG_BROWSER_DATA_DIR || '.browser-data',
    headless = process.env.HEADLESS !== 'false',
    targetDateKst,
  } = options

  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })

  console.log('[inventory] 브라우저 실행 (Wing 재고 수집)')
  const context: BrowserContext = await launchStealthPersistentContext({
    userDataDir: path.resolve(browserDataDir),
    headless,
    acceptDownloads: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1400, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })

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
    let inventoryHealthError: string | undefined

    // 재고현황 다운로드
    try {
      inventoryHealth = await downloadInventoryHealth(page, downloadDir)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[inventory] 재고현황 다운로드 실패:', msg)
      await saveScreenshot(page, 'inventory-health-error')
      inventoryHealthError = msg
    }

    let salesVendor: { filePath: string; fileName: string } | null = null
    let salesVendorError: string | undefined

    // 판매분석(VENDOR) 다운로드 — targetDateKst 가 지정된 경우에만 수집
    if (targetDateKst) {
      try {
        salesVendor = await downloadSalesAnalysisVendor(page, downloadDir, targetDateKst)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[inventory] 판매분석(VENDOR) 다운로드 실패:', msg)
        await saveScreenshot(page, 'sales-vendor-error')
        salesVendorError = msg
      }
    }

    return { inventoryHealth, inventoryHealthError, salesVendor, salesVendorError }
  } catch (error) {
    await saveScreenshot(page, 'inventory-error')
    throw error
  } finally {
    await context.close()
  }
}

// ─── 백필 전용 API ─────────────────────────────────────────────────────────────

/**
 * 백필 루프용 Wing 컨텍스트를 열고 로그인한다.
 * 반환된 context / page 는 호출자가 관리(닫기)한다.
 *
 * 사용 예:
 *   const { context, page } = await openWingSession(creds, opts)
 *   try {
 *     for (const date of dates) {
 *       await downloadSalesAnalysisVendorOnPage(page, downloadDir, date)
 *     }
 *   } finally {
 *     await context.close()
 *   }
 */
export async function openWingSession(
  credentials: { loginId: string; password: string },
  options: {
    downloadDir?: string
    browserDataDir?: string
    headless?: boolean
  } = {}
): Promise<{ context: BrowserContext; page: Page; downloadDir: string }> {
  const {
    downloadDir = path.resolve('.downloads'),
    browserDataDir = process.env.COUPANG_BROWSER_DATA_DIR || '.browser-data',
    headless = process.env.HEADLESS !== 'false',
  } = options

  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })

  const context: BrowserContext = await launchStealthPersistentContext({
    userDataDir: path.resolve(browserDataDir),
    headless,
    acceptDownloads: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1400, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })

  const page = context.pages()[0] || (await context.newPage())

  if (!(await isWingLoggedIn(page))) {
    await performWingLogin(page, credentials)
  } else {
    console.log('[inventory] 기존 Wing 세션 유지')
  }

  return { context, page, downloadDir }
}

/**
 * 이미 열린 page에서 판매분석 VENDOR 엑셀을 다운로드한다.
 * 백필 루프에서 컨텍스트를 재사용할 때 사용한다.
 *
 * 반환: 성공 시 { filePath, fileName }, 실패 시 { error: string }
 */
export async function downloadSalesAnalysisVendorOnPage(
  page: Page,
  downloadDir: string,
  targetDateKst: string
): Promise<{ filePath: string; fileName: string } | { error: string }> {
  try {
    const result = await downloadSalesAnalysisVendor(page, downloadDir, targetDateKst)
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await saveScreenshot(page, `sales-vendor-backfill-error-${targetDateKst}`)
    return { error: msg }
  }
}

/**
 * 단일 날짜 판매분석 VENDOR 수집 (컨텍스트 자체 관리).
 * 날짜 하나만 수집할 때 편의 API로 사용한다.
 * 여러 날짜 루프에는 openWingSession + downloadSalesAnalysisVendorOnPage 를 직접 쓸 것.
 *
 * 반환: 성공 시 { filePath, fileName }, 실패 시 { error: string }
 */
export async function collectSalesVendorForDate(
  credentials: { loginId: string; password: string },
  targetDateKst: string,
  options: {
    downloadDir?: string
    browserDataDir?: string
    headless?: boolean
  } = {}
): Promise<{ filePath: string; fileName: string } | { error: string }> {
  let context: BrowserContext | undefined
  try {
    const session = await openWingSession(credentials, options)
    context = session.context
    return await downloadSalesAnalysisVendorOnPage(session.page, session.downloadDir, targetDateKst)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: msg }
  } finally {
    await context?.close()
  }
}
