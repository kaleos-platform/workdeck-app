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
import { launchStealthPersistentContext, renewProfileLock } from './browser.js'

// ─── 타입 ────────────────────────────────────────────────────────────────────────

export interface InventoryCollectorResult {
  inventoryHealth: { filePath: string; fileName: string } | null
  /** 재고 다운로드 단계가 실패했을 때의 오류 메시지. 성공이면 undefined. */
  inventoryHealthError?: string
  /** 판매분석(상품별/VENDOR) 다운로드 결과. 성공이면 파일 경로. */
  salesVendor?: { filePath: string; fileName: string } | null
  /** 판매분석 다운로드 단계가 실패했을 때의 오류 메시지. 성공이면 undefined. */
  salesVendorError?: string
  /** self-heal: 같은 세션에서 추가 수집한 누락 일자 VENDOR 파일들(날짜별). 추가 로그인 없음. */
  gapVendors?: Array<{ dateKst: string; filePath: string; fileName: string }>
}

// ─── 상수 ────────────────────────────────────────────────────────────────────────

const WING_URL = 'https://wing.coupang.com'
const INVENTORY_HEALTH_URL = `${WING_URL}/tenants/rfm-inventory/management/list`
const SALES_ANALYSIS_URL = `${WING_URL}/tenants/business-insight/sales-analysis`
const SCREENSHOT_DIR = path.resolve('.screenshots')
const DEFAULT_TIMEOUT = 90_000
const DOWNLOAD_TIMEOUT = 120_000

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────────

async function saveScreenshot(page: Page, name: string): Promise<void> {
  // ⚠️ 진단용 스크린샷은 절대 throw 해선 안 된다. catch 블록에서 호출되는 경우가
  // 많은데(에러 직후 화면 캡처), 이때 page/context 가 이미 닫혔으면 screenshot 가
  // "Target page... closed" 로 throw → 진짜 에러를 가린다(2026-06-07 백필 크래시:
  // Chrome 사망이라는 진짜 원인이 screenshot 실패로 마스킹됨). 실패해도 삼킨다.
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
    const fileName = `${name}_${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, fileName), fullPage: true })
    console.log(`[inventory] 스크린샷: ${fileName}`)
  } catch (err) {
    console.warn(
      `[inventory] 스크린샷 저장 실패(무시): ${err instanceof Error ? err.message : String(err)}`
    )
  }
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
  const currentUrl = page.url()
  const alreadyOnLoginPage =
    currentUrl.includes('xauth.coupang.com') ||
    currentUrl.includes('/sso/login') ||
    currentUrl.includes('/login')

  // isWingLoggedIn()이 /dashboard 접근 중 이미 Coupang xauth 로그인 페이지로 redirect된 경우가 있다.
  // 이 상태에서 다시 /login으로 이동하면 redirect 체인이 hang 날 수 있으므로 현재 로그인 페이지를 재사용한다.
  if (!alreadyOnLoginPage) {
    await page.goto(`${WING_URL}/login`, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT,
    })
  }
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
function uniqueDownloadTarget(
  downloadDir: string,
  fileName: string
): { filePath: string; fileName: string } {
  const parsed = path.parse(fileName)
  let candidateName = fileName
  let candidatePath = path.join(downloadDir, candidateName)
  let counter = 1

  while (fs.existsSync(candidatePath)) {
    candidateName = `${parsed.name}_${Date.now()}_${counter}${parsed.ext}`
    candidatePath = path.join(downloadDir, candidateName)
    counter += 1
  }

  return { filePath: candidatePath, fileName: candidateName }
}

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
  const suggestedName = download.suggestedFilename()
  const baseName = suggestedName && suggestedName.trim().length > 0 ? suggestedName : fallbackName
  const target = uniqueDownloadTarget(downloadDir, baseName)
  await download.saveAs(target.filePath)
  return target
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

  // 그리드 로드 대기 (best-effort) — 부분 export 방지.
  // 표 데이터 행이 충분히 렌더될 때까지 잠시 대기한다. 셀렉터가 불확실하므로
  // 다건의 행(tr/role=row)이 보이면 OK로 보고, 못 찾아도 throw 하지 않고 진행한다
  // (행수 완전성은 업로드 단계의 이력 앵커 가드가 최종 방어한다).
  try {
    const rowLoc = page.locator('table tbody tr, [role="row"]')
    for (let i = 0; i < 10; i++) {
      const n = await rowLoc.count().catch(() => 0)
      if (n >= 10) break
      await page.waitForTimeout(1000)
    }
    await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {})
  } catch {
    // 그리드 대기 실패는 무시 — 업로드 가드가 부분 export 를 잡는다
  }

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
/**
 * 판매분석 기간 컨트롤(@vuepic/vue-datepicker)에서 targetDateKst(YYYY-MM-DD) 하루를 선택한다.
 *
 * 1) 툴바의 기간 트리거(span, cursor:pointer)를 클릭해 picker 를 연다.
 * 2) 캘린더에서 대상 날짜 셀([data-test-id="dp-YYYY-MM-DD"])을 시작·종료로 2번 클릭해
 *    1일 범위를 지정한다. 대상 월이 안 보이면 "이전 달" 화살표로 이동한다.
 * 3) picker 는 선택 즉시 적용된다(별도 조회 버튼 없음).
 *
 * 셀렉터는 2026-06 Wing live DOM 에서 확인. 실패 시 스크린샷을 남기고 throw —
 * 조용히 기본 기간(최근 7일)으로 export 되어 7배 과대 집계되는 것을 막기 위함이다.
 */
async function selectSalesAnalysisOneDay(page: Page, targetDateKst: string): Promise<void> {
  // 1) 기간 트리거 열기 — 툴바 내 기간 라벨(텍스트 가변)
  const trigger = page
    .locator('._toolbar_ejsky_5 span', {
      hasText: /최근|일별|직접|\d{4}\./,
    })
    .first()
  if (!(await trigger.isVisible({ timeout: 5000 }).catch(() => false))) {
    await saveScreenshot(page, 'sales-analysis-no-period-trigger')
    throw new Error('[inventory] 판매분석 기간 트리거를 찾지 못했습니다 — DOM 변경 의심')
  }
  await trigger.click()
  await page.waitForTimeout(800)

  const cellSelector = `[data-test-id="dp-${targetDateKst}"]`

  // 2) 대상 날짜 셀이 보일 때까지 "이전 달"로 이동(최대 18개월 = 백필 한도 여유)
  let cell = page.locator(`${cellSelector}[aria-selected]`).first()
  for (let i = 0; i < 18; i++) {
    if (await cell.isVisible({ timeout: 1000 }).catch(() => false)) break
    const prevMonth = page.locator('[class*="_prev_"]').first()
    if (!(await prevMonth.isVisible({ timeout: 800 }).catch(() => false))) break
    await prevMonth.click().catch(() => {})
    await page.waitForTimeout(300)
    cell = page.locator(`${cellSelector}[aria-selected]`).first()
  }

  if (!(await cell.isVisible({ timeout: 2000 }).catch(() => false))) {
    await saveScreenshot(page, 'sales-analysis-no-date-cell')
    throw new Error(
      `[inventory] 판매분석 캘린더에서 ${targetDateKst} 셀을 찾지 못했습니다 — DOM/월 네비 변경 의심`
    )
  }

  // 시작=종료=targetDate → 1일 범위
  await cell.click()
  await page.waitForTimeout(300)
  await cell.click()
  await page.waitForTimeout(500)

  // vue-datepicker 는 "선택 완료" 버튼을 눌러야 기간이 적용된다(즉시 적용 아님).
  // 이걸 누르지 않으면 picker 가 열린 채 남고 기존 기본 기간("어제")으로 export 되어
  // 과거 날짜 백필이 전부 어제 데이터로 채워지는 silent 과대집계가 발생한다.
  // 버튼 라벨은 "'06.05 (금)' 선택 완료"처럼 날짜 prefix 가 가변이므로 substring 매칭.
  const confirmBtn = page.locator('button:has-text("선택 완료")').first()
  if (!(await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    await saveScreenshot(page, 'sales-analysis-no-confirm-btn')
    throw new Error(
      `[inventory] 판매분석 기간 "선택 완료" 버튼을 찾지 못했습니다 (${targetDateKst}) — DOM 변경 의심`
    )
  }
  await confirmBtn.click()
  await page.waitForTimeout(500)
  console.log(`[inventory]   → 판매분석 기간 1일 선택 완료: ${targetDateKst}`)
}

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

  // ── 날짜 필터: 기간 = targetDateKst 1일 ──────────────────────────────────────
  // Wing 판매분석 기간 컨트롤은 @vuepic/vue-datepicker 다(2026-06 live DOM 확인).
  //   - 기간 트리거: 툴바(._toolbar_ejsky_5) 내 기간 라벨 span(텍스트 가변: "최근 7일" 등).
  //   - picker: 프리셋 버튼(오늘/어제/최근 N일) + 2개월 캘린더(셀 [data-test-id="dp-YYYY-MM-DD"]).
  //   - 선택 즉시 적용(별도 조회 버튼 없음, 하단 "초기화"만).
  // input fill 방식이 아니므로 캘린더 셀/프리셋 클릭으로 1일 범위를 지정한다.
  await selectSalesAnalysisOneDay(page, targetDateKst)

  await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(3000)
  await dismissModals(page)
  await saveScreenshot(page, 'sales-analysis-after-search')

  // ── 엑셀 다운로드 버튼 ──────────────────────────────────────────────────────
  // 2026-06 live DOM 확인: 엑셀 트리거는 <button> 이 아니라
  //   <div._wrapper><div._container><i icon:excel><span>엑셀 다운로드</span><i arrow-down></div></div>
  // 구조다. hashed 클래스(_container_hgdwt_6 등)는 Wing 재배포 시 회전하므로
  // 텍스트 "엑셀 다운로드"(고유 — "모바일 앱 다운로드"/"Download for…" 와 안 겹침)로
  // span 을 잡고 클릭 가능한 조상 div 를 타깃한다.
  const excelTextSpan = page.getByText('엑셀 다운로드', { exact: true }).first()
  let excelMainBtn = excelTextSpan.locator(
    'xpath=ancestor-or-self::div[contains(@class,"_container") or contains(@class,"_wrapper")][1]'
  )
  if (!(await excelMainBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    // fallback: span 자체 클릭(이벤트 위임이 처리하는 경우)
    excelMainBtn = excelTextSpan
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
    /** self-heal: 같은 세션에서 추가로 수집할 누락 일자(KST). 추가 Wing 로그인 없음. */
    gapDates?: string[]
  } = {}
): Promise<InventoryCollectorResult> {
  const {
    downloadDir = path.resolve('.downloads'),
    browserDataDir = process.env.COUPANG_BROWSER_DATA_DIR || '.browser-data',
    headless = process.env.HEADLESS !== 'false',
    targetDateKst,
    gapDates = [],
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

    // self-heal: 누락 일자 VENDOR 를 같은 세션에서 추가 수집 (추가 로그인 없음).
    // 어제(targetDateKst)는 위에서 이미 수집했으므로 제외.
    const gapVendors: Array<{ dateKst: string; filePath: string; fileName: string }> = []
    const uniqueGaps = Array.from(new Set(gapDates.filter((d) => d !== targetDateKst)))
    if (uniqueGaps.length > 0) {
      console.log(
        `[inventory] self-heal — 누락 ${uniqueGaps.length}일 추가 수집: ${uniqueGaps.join(', ')}`
      )
      for (const dateKst of uniqueGaps) {
        // 장시간 self-heal(최대 14일)이 진행 중임을 락에 알려 idle 타임아웃 갱신.
        renewProfileLock(context)
        try {
          const f = await downloadSalesAnalysisVendor(page, downloadDir, dateKst)
          gapVendors.push({ dateKst, filePath: f.filePath, fileName: f.fileName })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[inventory] self-heal 판매분석 실패 (${dateKst}): ${msg}`)
        }
      }
    }

    return { inventoryHealth, inventoryHealthError, salesVendor, salesVendorError, gapVendors }
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
