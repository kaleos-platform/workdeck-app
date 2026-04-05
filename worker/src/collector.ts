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

    // ── Step 5: 보고서 만들기 ──
    console.log('\n[5/7] 보고서 만들기...')
    await createReport(page)
    await saveScreenshot(page, 'report-created')

    // ── Step 6: 생성 완료 대기 ──
    console.log('\n[6/7] 생성 완료 대기...')
    await waitForReportReady(page)
    await saveScreenshot(page, 'report-ready')

    // ── Step 7: 다운로드 ──
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
  // 날짜 입력 필드가 있는지 확인
  const dateInputs = page.locator('input[type="date"], input[placeholder*="날짜"], input[placeholder*="시작"]')
  const dateInputCount = await dateInputs.count()

  if (dateInputCount >= 2) {
    // 직접 날짜 입력
    await dateInputs.nth(0).fill(dateFrom)
    await dateInputs.nth(1).fill(dateTo)
    console.log(`  → 날짜 직접 입력: ${dateFrom} ~ ${dateTo}`)
  } else {
    // 프리셋 버튼 사용 (최근 7일)
    const presets = ['최근 7일', '지난주', '이번달']
    for (const preset of presets) {
      const btn = page.locator(`button:has-text("${preset}")`)
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click()
        await page.waitForTimeout(1000)
        console.log(`  → 프리셋: ${preset}`)
        return
      }
    }
    console.log('  → 날짜 설정 셀렉터를 찾지 못함 (기본값 사용)')
  }
}

// ─── 캠페인 선택 ────────────────────────────────────────────────────────────────

async function selectCampaigns(page: Page): Promise<void> {
  // "캠페인을 선택하세요" 드롭다운 클릭
  const campaignSelect = page.locator('text=캠페인을 선택하세요, [placeholder*="캠페인"]').first()

  if (await campaignSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
    await campaignSelect.click()
    await page.waitForTimeout(1000)
    console.log('  → 캠페인 드롭다운 열림')

    // "전체 선택" 옵션이 있으면 클릭
    const selectAll = page.locator('text=전체 선택, text=전체, label:has-text("전체")').first()
    if (await selectAll.isVisible({ timeout: 2000 }).catch(() => false)) {
      await selectAll.click()
      console.log('  → 전체 캠페인 선택')
    } else {
      // 개별 캠페인 체크박스 전부 선택
      const checkboxes = page.locator('.ant-select-dropdown input[type="checkbox"], .ant-checkbox-input')
      const count = await checkboxes.count()
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          const cb = checkboxes.nth(i)
          if (!(await cb.isChecked())) {
            await cb.check()
          }
        }
        console.log(`  → ${count}개 캠페인 선택`)
      } else {
        // Ant Design Select 드롭다운의 옵션 클릭
        const options = page.locator('.ant-select-item, [class*="option"]')
        const optCount = await options.count()
        for (let i = 0; i < optCount; i++) {
          await options.nth(i).click()
          await page.waitForTimeout(200)
        }
        console.log(`  → ${optCount}개 옵션 클릭`)
      }
    }

    // 드롭다운 닫기 (body 클릭)
    await page.locator('h1, h2, .ant-page-header').first().click().catch(() => {})
    await page.waitForTimeout(500)
  } else {
    console.log('  → 캠페인 선택 UI를 찾지 못함')
    await saveScreenshot(page, 'campaign-select-not-found')
  }
}

// ─── 보고서 옵션 ────────────────────────────────────────────────────────────────

async function configureReportOptions(page: Page): Promise<void> {
  // "클릭이 발생한 키워드만 보고서에 포함" 체크박스 해제
  const keywordCheckbox = page.locator('text=클릭이 발생한 키워드만').locator('..')
  const checkbox = keywordCheckbox.locator('input[type="checkbox"]')

  if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
    if (await checkbox.isChecked()) {
      await checkbox.uncheck()
      console.log('  → "클릭 키워드만" 체크박스 해제')
    } else {
      console.log('  → "클릭 키워드만" 이미 해제됨')
    }
  } else {
    // label 텍스트로 찾기
    const label = page.locator('label:has-text("클릭이 발생한 키워드")')
    if (await label.isVisible({ timeout: 2000 }).catch(() => false)) {
      await label.click() // 토글
      console.log('  → label 클릭으로 체크박스 토글')
    } else {
      console.log('  → 키워드 필터 체크박스를 찾지 못함')
    }
  }
}

// ─── 보고서 만들기 ────────────────────────────────────────────────────────────────

async function createReport(page: Page): Promise<void> {
  // "보고서 만들기" 버튼이 활성화될 때까지 대기
  const createBtn = page.locator('button:has-text("보고서 만들기")')

  // 버튼이 enabled 될 때까지 대기 (최대 10초)
  try {
    await createBtn.waitFor({ state: 'visible', timeout: 10000 })

    // disabled 상태면 캠페인 미선택
    const isDisabled = await createBtn.isDisabled()
    if (isDisabled) {
      await saveScreenshot(page, 'create-disabled')
      throw new Error('"보고서 만들기" 버튼이 비활성화됨 — 캠페인을 선택해주세요')
    }

    await createBtn.click()
    console.log('  → "보고서 만들기" 클릭')
  } catch (error) {
    await saveScreenshot(page, 'no-create-button')
    throw new Error(`보고서 만들기 실패: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ─── 생성 완료 대기 ──────────────────────────────────────────────────────────────

async function waitForReportReady(page: Page): Promise<void> {
  // 오른쪽 테이블에서 "생성 완료" 상태 대기 (최대 120초)
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000)

    // 첫 번째 행의 상태 확인
    const status = await page.locator('td:has-text("생성 완료"), td:has-text("완료")').first()
      .isVisible().catch(() => false)

    if (status) {
      console.log(`  → 생성 완료 (${(i + 1) * 2}초)`)
      return
    }

    if (i % 5 === 0) {
      const processing = await page.locator('td:has-text("생성 중"), td:has-text("처리 중"), td:has-text("대기")').first()
        .isVisible().catch(() => false)
      if (processing) {
        console.log(`  → 처리 중... (${(i + 1) * 2}초)`)
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
