/**
 * 쿠팡 광고센터(https://advertising.coupang.com) 수집기
 *
 * 로그인 흐름:
 * 1. 로그인 유형 선택 페이지 → "쿠팡 wing" 로그인하기 클릭
 * 2. wing 로그인 폼 → ID/PW 입력 → 로그인
 * 3. 광고센터 대시보드로 리다이렉트
 *
 * 보고서 다운로드 흐름:
 * 1. 광고 보고서 메뉴 진입
 * 2. 매출 성장 광고 보고서 선택
 * 3. 기간 선택 + 기간 구분 "일별"
 * 4. "클릭이 발생한 키워드만 보고서 포함" 해제
 * 5. 운영중인 캠페인 모두 선택
 * 6. 보고서 만들기 → 다운로드
 */

import fs from 'node:fs'
import path from 'node:path'
import { chromium, type BrowserContext, type Page, type Download } from 'playwright'

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
}

export interface CollectorResult {
  filePath: string
  fileName: string
}

// ─── 상수 ────────────────────────────────────────────────────────────────────────

const COUPANG_ADS_URL = 'https://advertising.coupang.com'
const LOGIN_URL = `${COUPANG_ADS_URL}/marketing/dashboard`
const SCREENSHOT_DIR = path.resolve('.screenshots')
const DEFAULT_TIMEOUT = 30_000
const DOWNLOAD_TIMEOUT = 120_000

// ─── 헬퍼 함수 ──────────────────────────────────────────────────────────────────

function getYesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  }
  const fileName = `${name}_${new Date().toISOString().replace(/[:.]/g, '-')}.png`
  const filePath = path.join(SCREENSHOT_DIR, fileName)
  await page.screenshot({ path: filePath, fullPage: true })
  console.log(`스크린샷 저장: ${filePath}`)
}

// ─── 로그인 상태 확인 ──────────────────────────────────────────────────────────────

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto(COUPANG_ADS_URL + '/marketing/dashboard', {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT,
    })
    // 대시보드가 로드되면 로그인된 상태
    const url = page.url()
    return url.includes('/marketing/dashboard') && !url.includes('login')
  } catch {
    return false
  }
}

// ─── 메인 수집 함수 ──────────────────────────────────────────────────────────────

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
  } = options

  // 디렉토리 생성
  for (const dir of [downloadDir, path.resolve(browserDataDir)]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }

  console.log(`브라우저 실행 (headless: ${headless})`)
  console.log(`날짜 범위: ${dateFrom} ~ ${dateTo}`)

  const context: BrowserContext = await chromium.launchPersistentContext(
    path.resolve(browserDataDir),
    {
      headless,
      acceptDownloads: true,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  )

  const page = context.pages()[0] || (await context.newPage())

  try {
    // ── Step 1: 로그인 상태 확인 ──
    console.log('로그인 상태 확인 중...')
    const alreadyLoggedIn = await isLoggedIn(page)

    // ── Step 2: 로그인 수행 ──
    if (!alreadyLoggedIn) {
      console.log('로그인 필요')
      await performLogin(page, credentials)
    } else {
      console.log('기존 세션으로 로그인 유지됨')
    }

    await saveScreenshot(page, 'after-login')

    // ── Step 3: 보고서 페이지 이동 + 다운로드 ──
    console.log('보고서 다운로드 시작...')
    const result = await downloadReport(page, dateFrom, dateTo, downloadDir)

    console.log(`다운로드 완료: ${result.fileName}`)
    return result
  } catch (error) {
    await saveScreenshot(page, 'unexpected-error')
    throw error
  } finally {
    await context.close()
  }
}

// ─── 로그인 처리 ──────────────────────────────────────────────────────────────────

async function performLogin(page: Page, credentials: CollectorCredentials): Promise<void> {
  // 1. 광고센터 접속 → 로그인 유형 선택 페이지
  await page.goto(LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: DEFAULT_TIMEOUT,
  })

  await page.waitForTimeout(2000)
  await saveScreenshot(page, 'login-type-selection')

  try {
    // 2. "쿠팡 wing" 로그인하기 버튼 클릭 (첫 번째 "로그인하기" 버튼)
    // 로그인 유형 선택 페이지에서 wing 로그인 버튼 찾기
    const wingLoginBtn = page.locator('a:has-text("로그인하기"), button:has-text("로그인하기")').first()

    if (await wingLoginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('로그인 유형 선택 → 쿠팡 wing')
      await wingLoginBtn.click()
      await page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_TIMEOUT })
      await page.waitForTimeout(2000)
    }

    await saveScreenshot(page, 'login-form')

    // 3. 로그인 폼 입력 — wing 로그인 페이지의 실제 셀렉터
    console.log('로그인 정보 입력...')

    // ID 입력 필드 찾기 (다양한 셀렉터 시도)
    const idSelectors = [
      'input[name="username"]',
      'input[name="id"]',
      'input[name="loginId"]',
      'input[type="text"]',
      '#username',
      '#loginId',
      'input[placeholder*="아이디"]',
      'input[placeholder*="ID"]',
    ]

    let idFilled = false
    for (const selector of idSelectors) {
      const el = page.locator(selector).first()
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.fill(credentials.loginId)
        console.log(`ID 입력 완료 (${selector})`)
        idFilled = true
        break
      }
    }

    if (!idFilled) {
      await saveScreenshot(page, 'id-input-not-found')
      throw new Error('ID 입력 필드를 찾을 수 없습니다')
    }

    // PW 입력
    const pwInput = page.locator('input[type="password"]').first()
    await pwInput.waitFor({ timeout: 5000 })
    await pwInput.fill(credentials.password)
    console.log('비밀번호 입력 완료')

    // 로그인 버튼 클릭
    const loginBtn = page.locator(
      'button[type="submit"], button:has-text("로그인"), input[type="submit"]'
    ).first()
    await loginBtn.click()
    console.log('로그인 버튼 클릭')

    // 로그인 후 페이지 전환 대기
    await page.waitForTimeout(3000)

    // 로그인 성공 여부 확인
    const currentUrl = page.url()
    if (currentUrl.includes('login') || currentUrl.includes('error')) {
      await saveScreenshot(page, 'login-failed')
      throw new Error(`로그인 실패 — 현재 URL: ${currentUrl}`)
    }

    console.log('로그인 성공')
  } catch (error) {
    await saveScreenshot(page, 'login-error')
    throw new Error(
      `로그인 실패: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

// ─── 보고서 다운로드 ────────────────────────────────────────────────────────────────

async function downloadReport(
  page: Page,
  dateFrom: string,
  dateTo: string,
  downloadDir: string
): Promise<CollectorResult> {
  // 1. 사이드바에서 "광고보고서" 메뉴 클릭
  console.log('광고 보고서 페이지 이동...')

  // 사이드바에서 "광고보고서" 링크 찾기
  const reportMenuLink = page.locator('a:has-text("광고보고서"), a:has-text("광고 보고서")')
  if (await reportMenuLink.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await reportMenuLink.first().click()
    console.log('사이드바 → 광고보고서 클릭')
  } else {
    // 직접 URL 시도
    await page.goto(`${COUPANG_ADS_URL}/marketing/report`, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT,
    }).catch(() => {})
  }

  await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(3000)
  await saveScreenshot(page, 'report-page')

  // 2. "광고 보고서" 탭 클릭 (DIV.tabs-type 기반)
  const adReportTab = page.locator('div.tabs-type:has-text("광고 보고서")').first()
  if (await adReportTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await adReportTab.click()
    await page.waitForTimeout(2000)
    console.log('광고 보고서 탭 클릭')
  }

  await saveScreenshot(page, 'ad-report-tab')

  // 3. "매출 성장" 서브탭 클릭
  const salesTab = page.locator('text=매출 성장').first()
  if (await salesTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await salesTab.click()
    await page.waitForTimeout(2000)
    console.log('매출 성장 서브탭 선택')
  }

  await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(2000)
  await saveScreenshot(page, 'report-form')

  // 3. 날짜 설정은 UI에 따라 다름 — 스크린샷으로 확인 후 조정 필요
  console.log(`날짜 설정 시도: ${dateFrom} ~ ${dateTo}`)

  // 기간 구분 "일별" 선택
  const dailyOption = page.locator('text=일별, label:has-text("일별")')
  if (await dailyOption.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await dailyOption.first().click()
    console.log('기간 구분: 일별 선택')
  }

  // "클릭이 발생한 키워드만 보고서 포함" 체크박스 해제
  const keywordFilter = page.locator('text=클릭이 발생한 키워드만')
  if (await keywordFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
    const checkbox = keywordFilter.locator('..').locator('input[type="checkbox"]')
    if (await checkbox.isChecked()) {
      await checkbox.uncheck()
      console.log('키워드 필터 해제')
    }
  }

  await saveScreenshot(page, 'report-configured')

  // 4. 보고서 만들기 버튼
  const createBtn = page.locator('button:has-text("보고서 만들기"), button:has-text("조회"), button:has-text("다운로드")')
  if (await createBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('보고서 만들기 클릭...')

    // 다운로드 이벤트 대기
    const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT }).catch(() => null)
    await createBtn.first().click()

    const download = await downloadPromise

    if (download) {
      const fileName = download.suggestedFilename() || `coupang-report-${dateFrom}.xlsx`
      const filePath = path.join(downloadDir, fileName)
      await download.saveAs(filePath)
      console.log(`파일 저장: ${filePath}`)
      return { filePath, fileName }
    }
  }

  // 5. 다운로드 직접 시도 — 테이블에서 다운로드 버튼 찾기
  await page.waitForTimeout(3000)
  await saveScreenshot(page, 'waiting-download')

  const downloadBtn = page.locator('a:has-text("다운로드"), button:has-text("다운로드"), a[download]')
  if (await downloadBtn.first().isVisible({ timeout: 10000 }).catch(() => false)) {
    console.log('다운로드 버튼 클릭...')
    const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT })
    await downloadBtn.first().click()

    const download = await downloadPromise
    const fileName = download.suggestedFilename() || `coupang-report-${dateFrom}.xlsx`
    const filePath = path.join(downloadDir, fileName)
    await download.saveAs(filePath)
    return { filePath, fileName }
  }

  await saveScreenshot(page, 'download-failed')
  throw new Error('보고서 다운로드 버튼을 찾을 수 없습니다. 스크린샷을 확인하세요.')
}
