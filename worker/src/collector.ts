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
  // 1. 매출 성장 광고 보고서 페이지로 직접 이동
  console.log('매출 성장 광고 보고서 페이지 이동...')
  await page.goto(`${COUPANG_ADS_URL}/marketing-reporting/billboard/one-pager`, {
    waitUntil: 'domcontentloaded',
    timeout: DEFAULT_TIMEOUT,
  })
  await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(3000)
  await saveScreenshot(page, 'report-page')

  // 2. 날짜 범위 설정 — 프리셋 버튼 사용 (최근 7일)
  console.log('날짜 범위 설정...')
  const recentBtn = page.locator('button:has-text("최근 7일")')
  if (await recentBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await recentBtn.click()
    await page.waitForTimeout(2000)
    console.log('최근 7일 선택')
  }

  await saveScreenshot(page, 'date-selected')

  // 3. "캠페인별 성과" 탭 클릭 → 상세 데이터 보기
  console.log('캠페인별 성과 탭...')
  const campaignTab = page.locator('text=캠페인별 성과, button:has-text("캠페인별")')
  if (await campaignTab.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await campaignTab.first().click()
    await page.waitForTimeout(2000)
    console.log('캠페인별 성과 탭 클릭')
  }

  await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(2000)
  await saveScreenshot(page, 'campaign-view')

  // 4. 다운로드 시도 — 테이블의 "다운" 버튼 또는 엑셀 다운로드 버튼
  console.log('다운로드 버튼 탐색...')

  // ag-Grid 테이블의 다운로드 버튼 찾기
  const downloadSelectors = [
    'button:has-text("엑셀 다운로드")',
    'button:has-text("다운로드")',
    'button:has-text("Excel")',
    'a:has-text("다운")',
    'button:has-text("다운")',
    '[class*="download"]',
    'button:has(svg[class*="download"])',
  ]

  for (const selector of downloadSelectors) {
    const el = page.locator(selector).first()
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`다운로드 버튼 발견: ${selector}`)

      const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT })
      await el.click()

      const download = await downloadPromise
      const fileName = download.suggestedFilename() || `coupang-report-${dateFrom}.xlsx`
      const filePath = path.join(downloadDir, fileName)
      await download.saveAs(filePath)
      console.log(`파일 저장: ${filePath}`)
      return { filePath, fileName }
    }
  }

  // 5. 주차별 테이블의 "다운" 셀 클릭 시도
  console.log('테이블 다운 셀 탐색...')
  const downloadCells = page.locator('td:has-text("다운"), [role="gridcell"]:has-text("다운")')
  if (await downloadCells.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('테이블 다운 셀 발견')

    const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT })
    await downloadCells.first().click()

    const download = await downloadPromise
    const fileName = download.suggestedFilename() || `coupang-report-${dateFrom}.xlsx`
    const filePath = path.join(downloadDir, fileName)
    await download.saveAs(filePath)
    return { filePath, fileName }
  }

  await saveScreenshot(page, 'download-failed')
  throw new Error('보고서 다운로드 버튼을 찾을 수 없습니다. 스크린샷을 확인하세요.')
}
