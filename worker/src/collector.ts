/**
 * 쿠팡 광고센터 수집기
 *
 * 흐름:
 * 1. 로그인 (wing 유형)
 * 2. 광고 보고서 → 매출 성장 페이지 이동
 *    URL: https://advertising.coupang.com/marketing-reporting/billboard/reports/pa
 * 3. 기간 설정 (프리셋 또는 커스텀)
 * 4. 캠페인 선택 (시스템에 등록된 캠페인만)
 * 5. 보고서 구조: 캠페인 > 광고그룹 > 상품 > 키워드
 * 6. "클릭이 발생한 키워드만 보고서에 포함" 해제
 * 7. 보고서 만들기 → "생성 완료" 대기 → 다운로드
 */

import fs from 'node:fs'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'

// ─── 타입 ────────────────────────────────────────────────────────────────────────

export interface CollectorCredentials {
  loginId: string
  password: string
}

export interface CollectorOptions {
  headless?: boolean
  browserDataDir?: string
  dateFrom?: string
  dateTo?: string
  downloadDir?: string
  campaignIds?: string[] // 시스템에 등록된 캠페인 ID만 선택
  reportType?: 'pa' | 'nca' // pa=매출성장, nca=신규구매고객확보
}

export interface CollectorResult {
  filePath: string
  fileName: string
}

// ─── 상수 ────────────────────────────────────────────────────────────────────────

const COUPANG_ADS_URL = 'https://advertising.coupang.com'
const REPORT_URLS = {
  pa: `${COUPANG_ADS_URL}/marketing-reporting/billboard/reports/pa`,
  nca: `${COUPANG_ADS_URL}/marketing-reporting/billboard/reports/nca`,
}
const SCREENSHOT_DIR = path.resolve('.screenshots')
const DEFAULT_TIMEOUT = 30_000
const DOWNLOAD_TIMEOUT = 120_000

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────────

function getYesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const fileName = `${name}_${new Date().toISOString().replace(/[:.]/g, '-')}.png`
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, fileName), fullPage: true })
  console.log(`스크린샷: ${fileName}`)
}

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto(`${COUPANG_ADS_URL}/marketing/dashboard`, {
      waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT,
    })
    await page.waitForTimeout(2000)
    return !page.url().includes('login') && !page.url().includes('sso')
  } catch { return false }
}

// ─── 메인 함수 ──────────────────────────────────────────────────────────────────

export async function collectCoupangReport(
  credentials: CollectorCredentials,
  options: CollectorOptions = {}
): Promise<CollectorResult> {
  const {
    headless = process.env.HEADLESS !== 'false',
    browserDataDir = process.env.COUPANG_BROWSER_DATA_DIR || '.browser-data',
    dateFrom = getYesterday(),
    dateTo = getYesterday(),
    downloadDir = path.resolve('.downloads'),
    reportType = 'pa',
  } = options

  for (const dir of [downloadDir, path.resolve(browserDataDir)]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }

  console.log(`브라우저 실행 (headless: ${headless})`)
  console.log(`보고서: ${reportType === 'pa' ? '매출 성장' : '신규 구매 고객 확보'}`)
  console.log(`날짜: ${dateFrom} ~ ${dateTo}`)

  const context: BrowserContext = await chromium.launchPersistentContext(
    path.resolve(browserDataDir),
    {
      headless,
      acceptDownloads: true,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      viewport: { width: 1400, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  )

  const page = context.pages()[0] || (await context.newPage())

  try {
    // ── Step 1: 로그인 ──
    console.log('\n[1/6] 로그인 확인...')
    if (!(await isLoggedIn(page))) {
      await performLogin(page, credentials)
    } else {
      console.log('  → 기존 세션 유지')
    }

    // ── Step 2: 보고서 페이지 이동 ──
    console.log('\n[2/6] 보고서 페이지 이동...')
    await page.goto(REPORT_URLS[reportType], {
      waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT,
    })
    await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {})
    await page.waitForTimeout(3000)
    await saveScreenshot(page, 'report-page')
    console.log(`  → ${page.url()}`)

    // ── Step 3: 기간 설정 ──
    console.log('\n[3/6] 기간 설정...')
    await setDateRange(page, dateFrom, dateTo)
    await saveScreenshot(page, 'date-set')

    // ── Step 4: 캠페인 선택 + 보고서 옵션 ──
    console.log('\n[4/7] 캠페인 선택 + 옵션 설정...')
    await selectCampaigns(page)
    await configureReportOptions(page)
    await saveScreenshot(page, 'options-set')

    // ── Step 5: 기존 보고서 수 기록 후 보고서 만들기 ──
    console.log('\n[5/7] 보고서 만들기...')
    const prevDlCount = await page.locator('button:has-text("다운로드"), a:has-text("다운로드")').count()
    console.log(`  → 기존 다운로드 버튼: ${prevDlCount}개`)
    await createReport(page)
    await saveScreenshot(page, 'report-created')

    // ── Step 6: 새 보고서 생성 완료 대기 ──
    console.log('\n[6/7] 새 보고서 생성 완료 대기...')
    await waitForNewReport(page, prevDlCount)
    await saveScreenshot(page, 'report-ready')

    // ── Step 7: 다운로드 (첫 번째 = 최신) ──
    console.log('\n[7/7] 다운로드...')
    const result = await downloadReport(page, downloadDir, dateFrom)
    console.log(`  → 완료: ${result.fileName}`)
    return result
  } catch (error) {
    await saveScreenshot(page, 'error')
    throw error
  } finally {
    await context.close()
  }
}

// ─── 로그인 ──────────────────────────────────────────────────────────────────────

async function performLogin(page: Page, credentials: CollectorCredentials): Promise<void> {
  await page.goto(`${COUPANG_ADS_URL}/marketing/dashboard`, {
    waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT,
  })
  await page.waitForTimeout(2000)

  // wing "로그인하기" 버튼 클릭
  const wingBtn = page.locator('a:has-text("로그인하기"), button:has-text("로그인하기")').first()
  if (await wingBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('  → wing 로그인 선택')
    await wingBtn.click()
    await page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_TIMEOUT })
    await page.waitForTimeout(2000)
  }

  // ID 입력
  const idSelectors = ['input[name="username"]', 'input[name="id"]', 'input[type="text"]']
  for (const sel of idSelectors) {
    const el = page.locator(sel).first()
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.fill(credentials.loginId)
      console.log(`  → ID 입력 (${sel})`)
      break
    }
  }

  // PW 입력
  await page.locator('input[type="password"]').first().fill(credentials.password)

  // 로그인 버튼
  const loginBtn = page.locator('button[type="submit"], button:has-text("로그인"), input[type="submit"]').first()
  await loginBtn.waitFor({ timeout: 10000 })
  await loginBtn.click()
  await page.waitForTimeout(5000)

  if (page.url().includes('login') || page.url().includes('sso')) {
    await saveScreenshot(page, 'login-failed')
    throw new Error('로그인 실패')
  }
  console.log('  → 로그인 성공')
}

// ─── 기간 설정 ──────────────────────────────────────────────────────────────────

async function setDateRange(page: Page, dateFrom: string, dateTo: string): Promise<void> {
  // 1. 기간 구분을 "일별"로 설정 (기본이 "합계")
  // 라디오 버튼: "합계 · 일별" — Ant Design Radio Group
  const dailyRadio = page.locator('.ant-radio-wrapper:has-text("일별"), label:has-text("일별"), span:text-is("일별")')
  if (await dailyRadio.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await dailyRadio.first().click()
    await page.waitForTimeout(500)
    console.log('  → 기간 구분: 일별 선택')
  } else {
    // text 매칭으로 시도
    const allRadios = page.locator('.ant-radio-wrapper, [class*="radio"]')
    const radioCount = await allRadios.count()
    for (let i = 0; i < radioCount; i++) {
      const text = await allRadios.nth(i).textContent()
      if (text?.trim() === '일별') {
        await allRadios.nth(i).click()
        await page.waitForTimeout(500)
        console.log('  → 기간 구분: 일별 (radio index ' + i + ')')
        break
      }
    }
  }

  // 2. 직접 날짜 입력 (Ant Design DatePicker 호환)
  // 셀렉터 우선순위: Ant Design 5.x → 4.x → placeholder → generic input
  const dateSelectors = [
    '.ant-picker-input input',
    '.ant-calendar-picker-input',
    'input[placeholder*="날짜"]',
    'input[placeholder*="시작"]',
    'input[type="date"]',
    'input[type="text"][class*="date"]',
  ]

  let dateInputs = page.locator('_none_') // 빈 로케이터
  let dateInputCount = 0

  for (const selector of dateSelectors) {
    const locator = page.locator(selector)
    const count = await locator.count().catch(() => 0)
    if (count >= 2) {
      dateInputs = locator
      dateInputCount = count
      console.log(`  → 날짜 셀렉터 발견: "${selector}" (${count}개)`)
      break
    }
  }

  if (dateInputCount >= 2) {
    // Ant DatePicker: click → 전체 선택 → type으로 입력
    for (const [idx, value] of [[0, dateFrom], [1, dateTo]] as [number, string][]) {
      await dateInputs.nth(idx).click()
      await page.waitForTimeout(300)
      await dateInputs.nth(idx).fill('')
      await dateInputs.nth(idx).type(value, { delay: 50 })
      await page.waitForTimeout(300)
    }
    // Enter로 확정 후 DatePicker 닫기
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    console.log(`  → 날짜 직접 입력: ${dateFrom} ~ ${dateTo}`)
  } else {
    // 모든 input을 디버깅 출력
    const allInputs = page.locator('input')
    const inputCount = await allInputs.count()
    const inputInfo: string[] = []
    for (let i = 0; i < Math.min(inputCount, 10); i++) {
      const type = await allInputs.nth(i).getAttribute('type').catch(() => '?')
      const placeholder = await allInputs.nth(i).getAttribute('placeholder').catch(() => '')
      const cls = await allInputs.nth(i).getAttribute('class').catch(() => '')
      inputInfo.push(`[${i}] type=${type} placeholder="${placeholder}" class="${cls?.slice(0, 30)}"`)
    }
    console.log(`  → 날짜 설정 셀렉터를 찾지 못함 (input ${inputCount}개):`)
    inputInfo.forEach(info => console.log(`    ${info}`))
  }
}

// ─── 캠페인 선택 ────────────────────────────────────────────────────────────────

async function selectCampaigns(page: Page): Promise<void> {
  // "캠페인을 선택하세요" 버튼 클릭 (ant-dropdown-trigger)
  const campaignBtn = page.locator('.campaign-picker-dropdown-btn, button:has-text("캠페인을 선택하세요"), .ant-dropdown-trigger:has-text("캠페인")')

  if (await campaignBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await campaignBtn.first().click()
    await page.waitForTimeout(2000)
    console.log('  → 캠페인 드롭다운 열림')
    await saveScreenshot(page, 'campaign-dropdown-open')

    // 드롭다운 내부 체크박스 찾기
    const checkboxes = page.locator('.ant-dropdown input[type="checkbox"], .ant-checkbox-input, .ant-tree-checkbox')
    const cbCount = await checkboxes.count()

    if (cbCount > 0) {
      // 전체 선택 체크박스가 있으면 사용
      const selectAllCb = page.locator('.ant-dropdown label:has-text("전체"), .ant-dropdown .ant-checkbox-wrapper:has-text("전체")')
      if (await selectAllCb.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await selectAllCb.first().click()
        console.log('  → 전체 캠페인 선택')
      } else {
        // 개별 체크박스 클릭
        for (let i = 0; i < cbCount; i++) {
          const cb = checkboxes.nth(i)
          if (!(await cb.isChecked().catch(() => false))) {
            await cb.click()
            await page.waitForTimeout(200)
          }
        }
        console.log(`  → ${cbCount}개 체크박스 선택`)
      }
    } else {
      // 드롭다운 메뉴 아이템 클릭
      const menuItems = page.locator('.ant-dropdown-menu-item, .ant-dropdown li, [class*="campaign-picker"] li')
      const itemCount = await menuItems.count()
      console.log(`  → 드롭다운 아이템: ${itemCount}개`)
      for (let i = 0; i < itemCount; i++) {
        await menuItems.nth(i).click()
        await page.waitForTimeout(300)
      }
      console.log(`  → ${itemCount}개 아이템 클릭`)
    }

    // "확인" 버튼 클릭하여 캠페인 선택 확정
    const confirmBtn = page.locator('button:has-text("확인")').first()
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click()
      await page.waitForTimeout(1000)
      console.log('  → "확인" 클릭 — 캠페인 선택 확정')
    } else {
      // fallback: Escape
      await page.keyboard.press('Escape')
    }
    await page.waitForTimeout(500)

    await saveScreenshot(page, 'campaign-selected')
  } else {
    console.log('  → 캠페인 선택 버튼을 찾지 못함')
    await saveScreenshot(page, 'campaign-btn-not-found')
  }
}

// ─── 보고서 옵션 ────────────────────────────────────────────────────────────────

async function configureReportOptions(page: Page): Promise<void> {
  // "클릭이 발생한 키워드만 보고서에 포함" 체크박스 해제
  // 정확한 셀렉터: #ad-reporting-app .panel-options .form-item .space-left label
  const exactLabel = page.locator('#ad-reporting-app .panel-options .space-left label')

  if (await exactLabel.isVisible({ timeout: 3000 }).catch(() => false)) {
    // 체크박스 상태 확인
    const checkbox = exactLabel.locator('input[type="checkbox"]')
    const isChecked = await checkbox.isChecked().catch(() => false)

    if (isChecked) {
      await exactLabel.click()
      await page.waitForTimeout(500)
      console.log('  → "클릭 키워드만" 체크박스 해제')
    } else {
      console.log('  → "클릭 키워드만" 이미 해제됨')
    }
  } else {
    // fallback: 텍스트로 찾기
    const fallbackLabel = page.locator('label:has-text("클릭이 발생한 키워드")')
    if (await fallbackLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
      const cb = fallbackLabel.locator('input[type="checkbox"]')
      if (await cb.isChecked().catch(() => false)) {
        await fallbackLabel.click()
        console.log('  → fallback label 클릭으로 해제')
      } else {
        console.log('  → 이미 해제됨 (fallback)')
      }
    } else {
      console.log('  → 키워드 필터 체크박스를 찾지 못함')
    }
  }

  // 보고서 구조: "캠페인 > 광고그룹 > 상품 > 키워드" 선택 (가장 상세)
  const structureOptions = page.locator('.ant-radio-wrapper:has-text("키워드"), label:has-text("키워드")')
  if (await structureOptions.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await structureOptions.first().click()
    await page.waitForTimeout(500)
    console.log('  → 보고서 구조: 캠페인 > 광고그룹 > 상품 > 키워드')
  }
}

// ─── 보고서 만들기 ────────────────────────────────────────────────────────────────

async function createReport(page: Page): Promise<void> {
  const createBtn = page.locator('button:has-text("보고서 만들기")')
  await createBtn.waitFor({ state: 'visible', timeout: 10000 })

  // 버튼이 활성화될 때까지 대기 (최대 10초)
  for (let i = 0; i < 20; i++) {
    if (!(await createBtn.isDisabled())) break
    await page.waitForTimeout(500)
  }

  const isDisabled = await createBtn.isDisabled()
  if (isDisabled) {
    await saveScreenshot(page, 'create-disabled')
    throw new Error('"보고서 만들기" 버튼이 비활성화됨 — 캠페인을 선택해주세요')
  }

  await createBtn.click()
  await page.waitForTimeout(2000) // 보고서 생성 요청 후 대기
  console.log('  → "보고서 만들기" 클릭')
}

// ─── 새 보고서 생성 완료 대기 ────────────────────────────────────────────────────

async function waitForNewReport(page: Page, _prevDlCount: number): Promise<void> {
  // "보고서 내역" 탭 클릭 — 여기서 생성 상태 + 다운로드 가능
  const historyTab = page.locator('text=보고서 내역').first()
  if (await historyTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await historyTab.click()
    await page.waitForTimeout(2000)
    console.log('  → "보고서 내역" 탭 클릭')
  }

  await saveScreenshot(page, 'history-tab')

  // 최신 보고서(첫 행)에 "다운로드" 버튼이 나타날 때까지 대기
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000)

    // 다운로드 버튼 확인
    const dlBtn = page.locator('button:has-text("다운로드"), a:has-text("다운로드")').first()
    if (await dlBtn.isVisible().catch(() => false)) {
      // 첫 행의 다운로드인지 확인 (날짜가 오늘인지)
      console.log(`  → 다운로드 가능! (${(i + 1) * 2}초)`)
      return
    }

    // "생성 완료" 텍스트 확인
    const completed = page.locator('td:has-text("생성완료"), td:has-text("생성 완료"), text=생성완료').first()
    if (await completed.isVisible().catch(() => false)) {
      console.log(`  → 생성 완료 확인 (${(i + 1) * 2}초)`)
      await page.waitForTimeout(1000)
      return
    }

    if (i % 5 === 0) {
      console.log(`  → 대기 중... (${(i + 1) * 2}초)`)
      await saveScreenshot(page, `waiting-${i}`)
    }

    // 30초마다 탭 새로고침 (보고서 내역 다시 클릭)
    if (i > 0 && i % 15 === 0) {
      const refreshTab = page.locator('text=보고서 내역').first()
      if (await refreshTab.isVisible().catch(() => false)) {
        await refreshTab.click()
        await page.waitForTimeout(2000)
        console.log('  → 보고서 내역 새로고침')
      }
    }
  }

  await saveScreenshot(page, 'create-timeout')
  throw new Error('보고서 생성 타임아웃 (120초)')
}

// ─── 다운로드 ──────────────────────────────────────────────────────────────────

async function downloadReport(
  page: Page,
  downloadDir: string,
  dateFrom: string
): Promise<CollectorResult> {
  // "다운로드" 버튼 찾기 (보고서 테이블 우측)
  const downloadBtn = page.locator('button:has-text("다운로드"), a:has-text("다운로드")').first()

  if (!(await downloadBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
    await saveScreenshot(page, 'no-download-button')
    throw new Error('"다운로드" 버튼을 찾을 수 없습니다')
  }

  console.log('  → 다운로드 시작')
  const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT })
  await downloadBtn.click()

  const download = await downloadPromise
  const fileName = download.suggestedFilename() || `coupang-report-${dateFrom}.xlsx`
  const filePath = path.join(downloadDir, fileName)
  await download.saveAs(filePath)

  console.log(`  → 파일 저장: ${filePath}`)
  return { filePath, fileName }
}
