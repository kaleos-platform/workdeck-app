// 네이버 블로그 포스트 삭제 자동화 (bo 버전) — Playwright storageState 기반.
// 흐름:
//   1) chromium + storageState 로드 + navigator.webdriver 스푸핑 (addInitScript)
//   2) platformUrl(포스트 뷰 URL) 로 goto (domcontentloaded) + 5초 대기
//   3) 세션 만료 감지 (nidlogin|nid.naver.com/login) → LOGIN_EXPIRED
//   4) 글이 이미 없는 경우 (멱등) → ok: true
//   5) #mainFrame(PostView.naver) 프레임 확보
//   6) 삭제 버튼 탐색: frame.evaluate DOM 순회로 visible anchor/button 텍스트='삭제' 클릭
//      (locator.click('a:has-text("삭제")')은 숨은 #gnb_del_txt 에 걸려 타임아웃됨)
//   7) page.on('dialog') 로 confirm 자동 수락
//   8) 3~5초 대기 후 platformUrl 재접속 → 글 존재 확인 → DELETE_FAILED | ok
//
// 주의사항 (실계정 검증된 제약):
//   - storageState 없으면 AUTH_FAILED (비재시도).
//   - platformUrl 없거나 https://blog.naver.com/ 시작 아니면 VALIDATION.
//   - 로그인 페이지 감지: LOGIN_EXPIRED (비재시도).
//   - 삭제 버튼 click 전 dialog handler 등록 필수 (iframe 내 confirm 도 page 레벨 dialog 로 옴).
//   - 삭제 후 재접속 검증으로 DELETE_FAILED (재시도 가능) 반환.

import { chromium, type Browser, type Page, type Frame } from 'playwright'
import type { BoDeleteContext } from '../contracts.js'

export type BoDeleteErrorCode =
  | 'AUTH_FAILED'
  | 'LOGIN_EXPIRED'
  | 'VALIDATION'
  | 'PLATFORM_ERROR'
  | 'DELETE_FAILED'

export type BoDeleteResult = {
  ok: boolean
  errorCode?: BoDeleteErrorCode
  errorMessage?: string
}

/**
 * 네이버 블로그 포스트를 삭제한다.
 * platformUrl 로 포스트 뷰 페이지에 접근 후 삭제 버튼을 클릭한다.
 */
export async function deleteNaverBlogPost(ctx: BoDeleteContext): Promise<BoDeleteResult> {
  const storageState = ctx.credential?.payload?.storageState
  if (!storageState) {
    return {
      ok: false,
      errorCode: 'AUTH_FAILED',
      errorMessage:
        '네이버 블로그 자격증명(storageState)이 없습니다. 채널 자격증명을 등록하거나 수동 재로그인이 필요합니다.',
    }
  }

  const platformUrl = ctx.deployment.platformUrl
  if (!platformUrl || !platformUrl.startsWith('https://blog.naver.com/')) {
    return {
      ok: false,
      errorCode: 'VALIDATION',
      errorMessage: `platformUrl 이 유효하지 않습니다: ${platformUrl ?? '(없음)'}. https://blog.naver.com/ 로 시작해야 합니다.`,
    }
  }

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({
      headless: process.env.BO_NAVER_HEADLESS !== 'false',
    })
    const context = await browser.newContext({
      storageState: storageState as never,
      viewport: { width: 1280, height: 900 },
      locale: 'ko-KR',
    })
    // navigator.webdriver 스푸핑 — 네이버 SmartEditor 의 발행 버튼 onClick 이 이 값을 확인하고
    // 자동화 탐지 시 모달을 열지 않고 silent no-op 하는 것으로 확인됨.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    const page = await context.newPage()

    // confirm 다이얼로그 자동 수락 — 삭제 확인 팝업 처리.
    // iframe 내 confirm 도 page 레벨 dialog 이벤트로 전달된다.
    page.on('dialog', (dialog) => dialog.accept())

    await page.goto(platformUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(5000)

    // 세션 만료 감지
    if (/nidlogin|nid\.naver\.com\/login/.test(page.url())) {
      await safeClose(browser)
      return {
        ok: false,
        errorCode: 'LOGIN_EXPIRED',
        errorMessage:
          '네이버 세션이 만료됐습니다. acquire-naver-session 스크립트로 재발급 후 자격증명을 업데이트하세요.',
      }
    }

    // 글이 이미 없는 경우 (멱등) 처리 — PostView.naver 프레임 없으면 이미 삭제된 것으로 간주.
    if (isPostGone(page)) {
      await safeClose(browser)
      return { ok: true }
    }

    // PostView.naver 프레임(#mainFrame) 확보
    const viewFrame = await waitForViewFrame(page)
    if (!viewFrame) {
      await safeClose(browser)
      return {
        ok: false,
        errorCode: 'PLATFORM_ERROR',
        errorMessage: 'PostView.naver iframe 을 찾지 못했습니다.',
      }
    }

    // 글이 프레임 안에서도 없는 경우 (멱등)
    const alreadyGone = await checkPostGoneInFrame(viewFrame)
    if (alreadyGone) {
      await safeClose(browser)
      return { ok: true }
    }

    // 삭제 버튼 클릭 — locator.click('a:has-text("삭제")')은 숨은 #gnb_del_txt 에 걸려
    // 타임아웃되므로, frame.evaluate 로 DOM 순회하여 visible 한 요소만 클릭한다.
    const deleteClicked = await viewFrame.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('a, button'))
      const deleteBtn = candidates.find((el) => {
        const text = el.textContent?.trim()
        return text === '삭제' && el.offsetParent !== null
      })
      if (!deleteBtn) return false
      deleteBtn.click()
      return true
    })

    if (!deleteClicked) {
      await safeClose(browser)
      return {
        ok: false,
        errorCode: 'PLATFORM_ERROR',
        errorMessage:
          '삭제 버튼 미검출 — DOM 에서 visible "삭제" anchor/button 을 찾지 못했습니다.',
      }
    }

    // 삭제 후 안정화 대기 (3~5초)
    await page.waitForTimeout(4000)

    // 재접속하여 글이 실제로 삭제됐는지 확인
    await page.goto(platformUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)

    if (isPostGone(page)) {
      await safeClose(browser)
      return { ok: true }
    }

    // 재접속 후 프레임 재확보하여 내부 확인
    const verifyFrame = await waitForViewFrame(page, 8000)
    if (!verifyFrame) {
      // 프레임 자체가 없으면 삭제된 것으로 간주
      await safeClose(browser)
      return { ok: true }
    }

    const goneAfterDelete = await checkPostGoneInFrame(verifyFrame)
    if (goneAfterDelete) {
      await safeClose(browser)
      return { ok: true }
    }

    // 글이 여전히 존재함 — DELETE_FAILED (재시도 가능)
    await safeClose(browser)
    return {
      ok: false,
      errorCode: 'DELETE_FAILED',
      errorMessage: '삭제 후 재접속 시 포스트가 여전히 존재합니다. 재시도가 필요할 수 있습니다.',
    }
  } catch (err) {
    await safeClose(browser)
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      errorCode: 'PLATFORM_ERROR',
      errorMessage: message,
    }
  }
}

/**
 * PostView.naver 프레임(#mainFrame)을 대기 후 반환.
 * 타임아웃 시 null 반환.
 */
async function waitForViewFrame(page: Page, timeoutMs = 15000): Promise<Frame | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => f.url().includes('PostView.naver'))
    if (frame) return frame
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

/**
 * page URL 또는 page 내 텍스트로 포스트가 이미 삭제됐는지 확인 (page 레벨).
 * 프레임 없이 판단 가능한 경우 — 에러 페이지, 리다이렉트 등.
 */
function isPostGone(page: Page): boolean {
  const url = page.url()
  // 블로그 홈이나 목록 페이지로 리다이렉트된 경우
  if (/blog\.naver\.com\/[^/]+\/?$/.test(url) || url.includes('blog.naver.com/PostList')) {
    return true
  }
  return false
}

/**
 * PostView 프레임 내부에서 포스트 본문이 없거나 삭제/존재하지 않음 안내가 보이는지 확인.
 */
async function checkPostGoneInFrame(frame: Frame): Promise<boolean> {
  try {
    return await frame.evaluate(() => {
      // 존재하지 않는 글 안내 텍스트 탐색
      const bodyText = document.body?.textContent ?? ''
      if (
        bodyText.includes('삭제된 글') ||
        bodyText.includes('존재하지 않는 글') ||
        bodyText.includes('없는 글입니다')
      ) {
        return true
      }

      // 포스트 본문 영역이 없으면 삭제된 것으로 간주
      const postArea =
        document.querySelector('.post-view') ??
        document.querySelector('#postViewArea') ??
        document.querySelector('.se-main-container') ??
        document.querySelector('[class*="post_ct"]')
      return !postArea
    })
  } catch {
    // 프레임 접근 오류 — 삭제된 것으로 간주
    return true
  }
}

async function safeClose(browser: Browser | null): Promise<void> {
  try {
    if (browser) await browser.close()
  } catch {
    // noop
  }
}
