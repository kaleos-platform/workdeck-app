/**
 * 쿠팡 광고센터 Playwright 수집기
 * 쿠팡 광고센터(https://ads.coupang.com)에 로그인하여 리포트 Excel을 다운로드한다.
 */
import path from 'node:path'
import fs from 'node:fs'
import { chromium, type BrowserContext, type Page, type Download } from 'playwright'

// ─── 타입 정의 ─────────────────────────────────────────────────────────────────

export type CollectorCredentials = {
  loginId: string
  password: string // 복호화된 비밀번호
}

export type CollectorOptions = {
  /** headless 모드 (기본값: true) */
  headless?: boolean
  /** 브라우저 데이터 디렉토리 (persistent context) */
  browserDataDir?: string
  /** 리포트 날짜 범위 — 기본: 어제 */
  dateFrom?: string // YYYY-MM-DD
  dateTo?: string // YYYY-MM-DD
  /** 다운로드 저장 디렉토리 */
  downloadDir?: string
}

export type CollectorResult = {
  /** 다운로드된 파일의 절대 경로 */
  filePath: string
  /** 다운로드된 파일명 */
  fileName: string
}

// ─── 상수 ────────────────────────────────────────────────────────────────────────

const COUPANG_ADS_URL = 'https://ads.coupang.com'
const LOGIN_URL = `${COUPANG_ADS_URL}/login`
const SCREENSHOT_DIR = path.resolve('.screenshots')
const DEFAULT_TIMEOUT = 30_000 // 30초
const DOWNLOAD_TIMEOUT = 60_000 // 60초

// ─── 헬퍼 함수 ──────────────────────────────────────────────────────────────────

/** 어제 날짜를 YYYY-MM-DD 형식으로 반환 */
function getYesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

/** 실패 시 스크린샷을 저장한다 */
async function saveScreenshot(page: Page, name: string): Promise<string> {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(SCREENSHOT_DIR, `${name}_${timestamp}.png`)
  await page.screenshot({ path: filePath, fullPage: true })
  console.log(`스크린샷 저장: ${filePath}`)
  return filePath
}

/** 페이지가 로그인 상태인지 확인한다 (쿠키/세션 기반) */
async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    // 광고센터 메인 페이지로 이동해서 로그인 여부 확인
    await page.goto(COUPANG_ADS_URL, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT,
    })

    // 로그인 페이지로 리다이렉트되면 미로그인 상태
    const currentUrl = page.url()
    if (currentUrl.includes('/login')) {
      return false
    }

    // 대시보드나 메인 콘텐츠 영역이 보이면 로그인 완료
    try {
      await page.waitForSelector('[class*="dashboard"], [class*="gnb"], nav', {
        timeout: 5000,
      })
      return true
    } catch {
      return false
    }
  } catch {
    return false
  }
}

// ─── 메인 수집 함수 ──────────────────────────────────────────────────────────────

/**
 * 쿠팡 광고센터에서 리포트 Excel을 다운로드한다.
 *
 * 1. 브라우저 실행 (persistent context로 세션 유지)
 * 2. 로그인 상태 확인 → 미로그인 시 로그인 수행
 * 3. 리포트 다운로드 페이지 이동
 * 4. 날짜 범위 설정 → Excel 다운로드
 * 5. 다운로드된 파일 경로 반환
 */
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

  // 다운로드 디렉토리 생성
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true })
  }

  // 브라우저 데이터 디렉토리 생성
  const browserDataPath = path.resolve(browserDataDir)
  if (!fs.existsSync(browserDataPath)) {
    fs.mkdirSync(browserDataPath, { recursive: true })
  }

  console.log(`브라우저 실행 (headless: ${headless})`)
  console.log(`날짜 범위: ${dateFrom} ~ ${dateTo}`)

  // Persistent context로 브라우저 실행 (세션/쿠키 유지)
  const context: BrowserContext = await chromium.launchPersistentContext(browserDataPath, {
    headless,
    acceptDownloads: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 720 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })

  const page = context.pages()[0] || (await context.newPage())

  try {
    // ── Step 1: 로그인 상태 확인 ──
    console.log('로그인 상태 확인 중...')
    const alreadyLoggedIn = await isLoggedIn(page)

    // ── Step 2: 로그인 수행 (필요 시) ──
    if (!alreadyLoggedIn) {
      console.log('로그인 필요 — 로그인 페이지 이동')
      await page.goto(LOGIN_URL, {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_TIMEOUT,
      })

      try {
        // 아이디 입력
        const idInput = page.locator('input[type="text"], input[name="username"], input[name="id"], #username, #loginId')
        await idInput.first().waitFor({ timeout: 10_000 })
        await idInput.first().fill(credentials.loginId)

        // 비밀번호 입력
        const pwInput = page.locator('input[type="password"]')
        await pwInput.first().fill(credentials.password)

        // 로그인 버튼 클릭
        const loginBtn = page.locator(
          'button[type="submit"], button:has-text("로그인"), button:has-text("Login")'
        )
        await loginBtn.first().click()

        // 로그인 후 페이지 전환 대기
        await page.waitForURL((url) => !url.toString().includes('/login'), {
          timeout: DEFAULT_TIMEOUT,
        })

        console.log('로그인 성공')
      } catch (error) {
        await saveScreenshot(page, 'login-failure')
        throw new Error(
          `로그인 실패: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    } else {
      console.log('기존 세션으로 로그인 유지됨')
    }

    // ── Step 3: 리포트 다운로드 페이지 이동 ──
    console.log('리포트 다운로드 페이지 이동...')
    try {
      // 쿠팡 광고센터의 리포트/다운로드 페이지로 이동
      // 실제 URL은 쿠팡 광고센터 구조에 따라 조정 필요
      await page.goto(`${COUPANG_ADS_URL}/reports/download`, {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_TIMEOUT,
      })

      // 페이지 로드 대기
      await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT })
    } catch (error) {
      await saveScreenshot(page, 'report-page-navigation')
      throw new Error(
        `리포트 페이지 이동 실패: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    // ── Step 4: 날짜 범위 설정 ──
    console.log(`날짜 범위 설정: ${dateFrom} ~ ${dateTo}`)
    try {
      // 시작일 입력 (date picker 셀렉터는 실제 UI에 맞게 조정)
      const dateFromInput = page.locator(
        'input[name="startDate"], input[placeholder*="시작"], input.date-from'
      )
      if (await dateFromInput.first().isVisible()) {
        await dateFromInput.first().fill(dateFrom)
      }

      // 종료일 입력
      const dateToInput = page.locator(
        'input[name="endDate"], input[placeholder*="종료"], input.date-to'
      )
      if (await dateToInput.first().isVisible()) {
        await dateToInput.first().fill(dateTo)
      }

      // 조회/검색 버튼 클릭 (있을 경우)
      const searchBtn = page.locator(
        'button:has-text("조회"), button:has-text("검색"), button:has-text("적용")'
      )
      if (await searchBtn.first().isVisible()) {
        await searchBtn.first().click()
        await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT })
      }
    } catch (error) {
      await saveScreenshot(page, 'date-range-setting')
      throw new Error(
        `날짜 범위 설정 실패: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    // ── Step 5: Excel 다운로드 (재시도 1회) ──
    console.log('Excel 다운로드 시작...')
    let download: Download | undefined
    let retryCount = 0
    const maxRetries = 1

    while (retryCount <= maxRetries) {
      try {
        // 다운로드 이벤트 리스닝 시작
        const downloadPromise = page.waitForEvent('download', {
          timeout: DOWNLOAD_TIMEOUT,
        })

        // 다운로드 버튼 클릭
        const downloadBtn = page.locator(
          'button:has-text("다운로드"), button:has-text("Download"), button:has-text("엑셀"), a:has-text("다운로드")'
        )
        await downloadBtn.first().click()

        // 다운로드 완료 대기
        download = await downloadPromise
        break // 성공 시 루프 탈출
      } catch (error) {
        retryCount++
        if (retryCount > maxRetries) {
          await saveScreenshot(page, 'download-failure')
          throw new Error(
            `Excel 다운로드 실패 (${maxRetries + 1}회 시도): ${error instanceof Error ? error.message : String(error)}`
          )
        }
        console.log(`다운로드 재시도 (${retryCount}/${maxRetries})...`)
        // 잠시 대기 후 재시도
        await page.waitForTimeout(2000)
      }
    }

    if (!download) {
      throw new Error('다운로드 객체를 가져올 수 없습니다')
    }

    // 다운로드 파일 저장
    const suggestedName = download.suggestedFilename() || `coupang-report-${dateFrom}.xlsx`
    const filePath = path.join(downloadDir, suggestedName)
    await download.saveAs(filePath)

    console.log(`다운로드 완료: ${filePath}`)

    return {
      filePath,
      fileName: suggestedName,
    }
  } catch (error) {
    // 예상치 못한 에러 시 스크린샷 저장
    try {
      await saveScreenshot(page, 'unexpected-error')
    } catch {
      // 스크린샷 실패는 무시
    }
    throw error
  } finally {
    // 브라우저 컨텍스트 종료 (persistent context이므로 쿠키는 보존됨)
    await context.close()
  }
}
