// 티스토리 브라우저 자동화 퍼블리셔 — Playwright storageState(쿠키) 기반.
// 흐름:
//   1) chromium + storageState(쿠키 JSON) 로드
//   2) https://www.tistory.com 접속으로 쿠키 적용 확인
//   3) https://{blogName}.tistory.com/manage/post/write 로 이동
//   4) 로그인 여부 확인 (로그인 페이지 감지 → LOGIN_EXPIRED)
//   5) 에디터 로드 대기 — Markdown/HTML 모드 전환 시도(가능 시), 아니면 비주얼 모드 사용
//   6) 제목 입력 + 본문 입력
//   7) 발행 버튼 클릭 → 결과 URL 캡처 ({blogName}.tistory.com/{postId})
//
// ⚠️ 셀렉터 주의사항:
//   티스토리 에디터는 TinyMCE 기반 비주얼 + Markdown/HTML 코드 뷰 전환 구조.
//   아래 셀렉터는 2026년 기준 best-effort — 티스토리 에디터 업데이트로 셀렉터가 바뀔 수 있음.
//   실제 운영 전 반드시 live 계정 E2E 검증 필요 (자동화 검증 불가).
//
// 에러 코드:
//   LOGIN_EXPIRED    — 세션 만료, 자격증명 재등록 필요 (재시도 불필요)
//   EDITOR_NOT_FOUND — 에디터 DOM 을 찾지 못함 (플랫폼 DOM 변경, 재시도 가능)
//   PUBLISH_FAILED   — 발행 버튼 클릭 후 완료 확인 실패 (재시도 가능)
//   URL_CAPTURE_FAILED — 발행 후 포스트 URL 추출 실패 (재시도 가능)

import { chromium, type Browser, type Page } from 'playwright'
import type { BoPublisher, BoPublishResult, BoPublishErrorCode } from './index.js'
import type { BoPublishContext } from '../contracts.js'
import { renderDocToPlainText } from './_naver-doc-text.js'

export class TistoryBrowserPublisher implements BoPublisher {
  readonly name = 'bo-tistory-browser'

  async publish(ctx: BoPublishContext): Promise<BoPublishResult> {
    const storageState = ctx.credential?.payload?.storageState
    if (!storageState) {
      return {
        ok: false,
        errorCode: 'AUTH_FAILED',
        errorMessage: '티스토리 자격증명(storageState)이 없습니다. 채널 자격증명을 등록하세요.',
      }
    }

    const blogName =
      typeof ctx.channel.config?.blogName === 'string'
        ? (ctx.channel.config.blogName as string)
        : null
    if (!blogName) {
      return {
        ok: false,
        errorCode: 'VALIDATION',
        errorMessage: '채널 config.blogName 이 필요합니다 (예: "my-blog").',
      }
    }

    let browser: Browser | null = null
    try {
      browser = await chromium.launch({
        headless: process.env.BO_TISTORY_HEADLESS !== 'false',
      })
      const context = await browser.newContext({
        storageState: storageState as never,
        viewport: { width: 1280, height: 900 },
        locale: 'ko-KR',
      })

      const page = await context.newPage()

      // 쿠키가 tistory.com 도메인에 적용되도록 먼저 루트 방문
      await page.goto('https://www.tistory.com', { waitUntil: 'domcontentloaded', timeout: 20000 })
      await page.waitForTimeout(1000)

      // 새 글 작성 페이지로 이동
      const writeUrl = `https://${blogName}.tistory.com/manage/post/write`
      await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
      await page.waitForTimeout(3000)

      // 로그인 여부 확인
      const currentUrl = page.url()
      if (isLoginPage(currentUrl)) {
        await safeClose(browser)
        return {
          ok: false,
          errorCode: 'LOGIN_EXPIRED',
          errorMessage:
            '티스토리 세션이 만료됐습니다. 브라우저에서 재로그인 후 storageState 를 갱신하세요.',
        }
      }

      // 에디터 모드 전환 시도 (Markdown/HTML 모드 우선)
      const usedCodeMode = await tryEnableCodeMode(page)

      // 제목 입력
      const titleFilled = await fillTitle(page, ctx.variant.title)
      if (!titleFilled) {
        await safeClose(browser)
        return {
          ok: false,
          errorCode: 'EDITOR_NOT_FOUND',
          errorMessage: '제목 입력 영역을 찾지 못했습니다.',
        }
      }

      // 본문 입력
      const bodyText = renderDocToPlainText(ctx.variant.doc)
      const contentFilled = await fillContent(page, bodyText, usedCodeMode)
      if (!contentFilled) {
        await safeClose(browser)
        return {
          ok: false,
          errorCode: 'EDITOR_NOT_FOUND',
          errorMessage: '본문 입력 영역을 찾지 못했습니다.',
        }
      }

      // 발행 버튼 클릭
      const published = await clickPublish(page)
      if (!published) {
        await safeClose(browser)
        return {
          ok: false,
          errorCode: 'PUBLISH_FAILED',
          errorMessage: '발행 버튼을 찾지 못하거나 발행 확인에 실패했습니다.',
        }
      }

      // 발행 후 URL 캡처 — {blogName}.tistory.com/{postNumber}
      const platformUrl = await capturePostUrl(page, blogName)
      if (!platformUrl) {
        await safeClose(browser)
        return {
          ok: false,
          errorCode: 'URL_CAPTURE_FAILED',
          errorMessage: '발행 후 포스트 URL 을 확인하지 못했습니다.',
        }
      }

      await safeClose(browser)
      return { ok: true, platformUrl }
    } catch (err) {
      await safeClose(browser)
      const message = err instanceof Error ? err.message : String(err)
      const errorCode: BoPublishErrorCode = /timeout/i.test(message)
        ? 'PLATFORM_ERROR'
        : 'PLATFORM_ERROR'
      return { ok: false, errorCode, errorMessage: message }
    }
  }
}

/** 로그인 페이지 URL 패턴 감지 */
function isLoginPage(url: string): boolean {
  return /tistory\.com\/auth\/login|kakao\.com\/login|accounts\.kakao\.com/.test(url)
}

/**
 * Markdown/HTML 코드 뷰 전환 시도.
 * 가능하면 true 반환(코드 모드 사용), 비주얼 모드만 있으면 false.
 * 셀렉터는 best-effort — E2E 검증 필요.
 */
async function tryEnableCodeMode(page: Page): Promise<boolean> {
  try {
    // 티스토리 에디터 상단의 모드 전환 버튼 후보들
    const modeSelectors = [
      'button[data-type="markdown"]',
      'button[title="마크다운"]',
      'button[title="Markdown"]',
      'button[data-editor-mode="markdown"]',
      '.editor-mode-tab[data-mode="markdown"]',
    ]
    for (const sel of modeSelectors) {
      const btn = page.locator(sel).first()
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 3000 })
        await page.waitForTimeout(800)
        return true
      }
    }
  } catch {
    // 모드 전환 실패 → 비주얼 모드 유지
  }
  return false
}

/**
 * 제목 입력.
 * 셀렉터는 best-effort — E2E 검증 필요.
 */
async function fillTitle(page: Page, title: string): Promise<boolean> {
  const titleSelectors = [
    '#post-title-inp',
    'input[name="title"]',
    '.titleArea input',
    'input[placeholder*="제목"]',
    '.editor-title input',
  ]
  for (const sel of titleSelectors) {
    try {
      const el = page.locator(sel).first()
      if ((await el.count()) > 0) {
        await el.waitFor({ state: 'visible', timeout: 8000 })
        await el.click()
        await el.fill(title)
        return true
      }
    } catch {
      // 다음 셀렉터 시도
    }
  }
  return false
}

/**
 * 본문 입력 — 코드 모드(textarea) 또는 비주얼 모드(contenteditable/TinyMCE iframe).
 * 셀렉터는 best-effort — E2E 검증 필요.
 */
async function fillContent(page: Page, text: string, codeMode: boolean): Promise<boolean> {
  if (codeMode) {
    // 마크다운/HTML 모드: textarea 에 직접 입력
    const codeSelectors = [
      '.CodeMirror textarea',
      'textarea[name="content"]',
      '.editor-content textarea',
      '#editor-content',
    ]
    for (const sel of codeSelectors) {
      try {
        const el = page.locator(sel).first()
        if ((await el.count()) > 0) {
          await el.waitFor({ state: 'visible', timeout: 8000 })
          await el.click()
          // CodeMirror textarea 는 직접 fill 이 작동하지 않는 경우가 있어 keyboard 입력 사용
          await page.keyboard.type(text, { delay: 2 })
          return true
        }
      } catch {
        // 다음 셀렉터 시도
      }
    }
  }

  // 비주얼 모드: TinyMCE iframe contenteditable 또는 contenteditable div
  try {
    // TinyMCE iframe 내부 body
    const editorFrame = page
      .frameLocator('#editor-tistory_ifr, iframe.tox-edit-area__iframe')
      .first()
    const editorBody = editorFrame.locator('body')
    if ((await editorBody.count()) > 0) {
      await editorBody.waitFor({ state: 'visible', timeout: 8000 })
      await editorBody.click()
      await page.keyboard.type(text, { delay: 2 })
      return true
    }
  } catch {
    // TinyMCE iframe 없음
  }

  // contenteditable div 직접 시도
  const visualSelectors = [
    '.editor-content [contenteditable="true"]',
    '[data-role="content-editable"]',
    '.ProseMirror',
  ]
  for (const sel of visualSelectors) {
    try {
      const el = page.locator(sel).first()
      if ((await el.count()) > 0) {
        await el.waitFor({ state: 'visible', timeout: 5000 })
        await el.click()
        await page.keyboard.type(text, { delay: 2 })
        return true
      }
    } catch {
      // 다음 시도
    }
  }

  return false
}

/**
 * 발행 버튼 클릭 + 확인 팝업 처리.
 * 셀렉터는 best-effort — E2E 검증 필요.
 */
async function clickPublish(page: Page): Promise<boolean> {
  const publishSelectors = [
    'button#publish-layer-btn',
    'button[data-type="publish"]',
    'button.publish-btn',
    'button[title="발행"]',
    'button:has-text("발행")',
  ]

  let clicked = false
  for (const sel of publishSelectors) {
    try {
      const btn = page.locator(sel).first()
      if ((await btn.count()) > 0) {
        await btn.waitFor({ state: 'visible', timeout: 5000 })
        await btn.click()
        clicked = true
        break
      }
    } catch {
      // 다음 셀렉터 시도
    }
  }
  if (!clicked) return false

  // 발행 확인 팝업이 있으면 확인 버튼 클릭
  await page.waitForTimeout(1000)
  const confirmSelectors = [
    'button.confirm-publish',
    'button[data-btn-role="publish-confirm"]',
    '.layer-publish button:has-text("발행")',
    '.publish-layer button:has-text("완료")',
  ]
  for (const sel of confirmSelectors) {
    try {
      const btn = page.locator(sel).first()
      if ((await btn.count()) > 0 && (await btn.isVisible())) {
        await btn.click({ timeout: 3000 })
        break
      }
    } catch {
      // 팝업 없음 — 단계 발행 버튼으로 완료됐을 수 있음
    }
  }

  return true
}

/**
 * 발행 완료 후 포스트 URL 캡처.
 * {blogName}.tistory.com/{postNumber} 패턴으로 리다이렉트 또는 현재 URL 파싱.
 */
async function capturePostUrl(page: Page, blogName: string): Promise<string | null> {
  const postUrlPattern = new RegExp(`${blogName}\\.tistory\\.com/\\d+`)

  // 리다이렉트 대기 (최대 30초)
  try {
    await page.waitForURL(postUrlPattern, { timeout: 30000 })
    return page.url()
  } catch {
    // 리다이렉트 없이 현재 URL 이 포스트 URL 인 경우
    const current = page.url()
    if (postUrlPattern.test(current)) return current
  }

  // 페이지 내 포스트 URL 링크 탐색 (일부 에디터는 리다이렉트 대신 성공 토스트 + 링크 표시)
  try {
    const linkLocator = page.locator(`a[href*="${blogName}.tistory.com/"]`).first()
    if ((await linkLocator.count()) > 0) {
      const href = await linkLocator.getAttribute('href', { timeout: 3000 })
      if (href && postUrlPattern.test(href)) return href
    }
  } catch {
    // 링크 없음
  }

  return null
}

async function safeClose(browser: Browser | null): Promise<void> {
  try {
    if (browser) await browser.close()
  } catch {
    // noop
  }
}
