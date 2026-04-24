// 네이버 블로그 브라우저 자동화 퍼블리셔 — Playwright storageState 기반.
// SmartEditor ONE (v4) 대응. 흐름:
//   1) chromium + storageState 로드
//   2) /{blogId}?Redirect=Write 이동 → iframe(PostWriteForm.naver) 대기
//   3) 임시저장 팝업 있으면 취소
//   4) 제목 영역 클릭 → keyboard.type(title)
//   5) Tab 또는 본문 영역 클릭 → 본문 text 주입
//   6) 발행 버튼 클릭 → 설정 팝업 → 최종 발행
//   7) post URL 이 https://blog.naver.com/{blogId}/{postId} 로 리다이렉트되면 성공
//
// 세션 만료(로그인 페이지로 튕김) 시 AUTH_FAILED 반환.
// DOM 변경·타임아웃 시 PLATFORM_ERROR.

import { chromium, type Browser, type Page, type Frame } from 'playwright'
import type { Publisher, PublishContext, PublishResult } from './index.js'
import { renderDocToPlainText } from './_naver-doc-text.js'

export class NaverBlogBrowserPublisher implements Publisher {
  readonly name = 'naver-blog-browser'

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const storageState = ctx.credential?.payload?.storageState
    if (!storageState) {
      return {
        ok: false,
        errorCode: 'AUTH_FAILED',
        errorMessage:
          '네이버 블로그 자격증명(storageState)이 없습니다. 채널 자격증명을 등록하거나 수동 재로그인이 필요합니다.',
      }
    }

    const blogId =
      typeof ctx.credential?.payload?.blogId === 'string'
        ? (ctx.credential.payload.blogId as string)
        : null
    if (!blogId) {
      return {
        ok: false,
        errorCode: 'VALIDATION',
        errorMessage: '채널 자격증명 payload.blogId 가 필요합니다 (예: "meaning-lab").',
      }
    }

    let browser: Browser | null = null
    try {
      browser = await chromium.launch({
        headless: process.env.SC_NAVER_HEADLESS !== 'false',
        args: ['--disable-blink-features=AutomationControlled'],
      })
      const context = await browser.newContext({
        storageState: storageState as never,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 900 },
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
      })
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })

      const page = await context.newPage()
      const writeUrl = `https://blog.naver.com/${blogId}?Redirect=Write`
      await page.goto(writeUrl, { waitUntil: 'domcontentloaded' })

      // 세션 만료 감지 — 로그인 페이지로 튕기면 URL 에 nidlogin 이 포함
      await page.waitForTimeout(3000)
      if (/nidlogin|nid\.naver\.com\/login/.test(page.url())) {
        await safeClose(browser)
        return {
          ok: false,
          errorCode: 'AUTH_FAILED',
          errorMessage:
            '네이버 세션이 만료됐습니다. acquire-naver-session 스크립트로 재발급 후 자격증명을 업데이트하세요.',
        }
      }

      // PostWriteForm iframe 확보
      const editorFrame = await waitForEditorFrame(page)
      if (!editorFrame) {
        await safeClose(browser)
        return {
          ok: false,
          errorCode: 'PLATFORM_ERROR',
          errorMessage: 'PostWriteForm iframe 을 찾지 못함',
        }
      }

      // 임시저장 팝업 닫기 (있으면)
      await dismissDraftDialog(editorFrame).catch(() => {})

      // 제목 입력
      const titleLocator = editorFrame.locator('.se-section-documentTitle .se-text-paragraph')
      await titleLocator.first().waitFor({ state: 'visible', timeout: 15000 })
      await titleLocator.first().click()
      await page.waitForTimeout(300)
      await page.keyboard.type(ctx.content.title, { delay: 20 })

      // 본문 — 본문 영역 명시적 클릭 (Tab 은 텍스트를 제목에 이어붙이는 버그 발생)
      const bodyText = renderDocToPlainText(ctx.content.doc, ctx.deploymentUrl)
      const bodyLocator = editorFrame.locator('.se-section-text .se-text-paragraph').first()
      await bodyLocator.waitFor({ state: 'visible', timeout: 8000 })
      await bodyLocator.click()
      await page.waitForTimeout(500)
      // 본문 paragraph 별로 개행
      const chunks = bodyText.split('\n')
      for (let i = 0; i < chunks.length; i++) {
        const line = chunks[i] ?? ''
        if (line) await page.keyboard.type(line, { delay: 5 })
        if (i < chunks.length - 1) {
          await page.keyboard.press('Enter')
        }
      }

      // 발행 버튼 (툴바) 클릭
      const publishButton = editorFrame.locator(
        'button[data-log="pub.publish"], button.publish_btn__m9KHH'
      )
      await publishButton.first().waitFor({ state: 'visible', timeout: 10000 })
      await publishButton.first().click()
      await page.waitForTimeout(1500)

      // 설정 팝업 → 최종 발행
      const finalPublish = editorFrame.locator(
        'button[data-log="cnf.publish"], button.confirm_btn__WEaBq'
      )
      if ((await finalPublish.count()) > 0) {
        await finalPublish.first().click()
      } else {
        // fallback: 텍스트 매칭
        const publishText = editorFrame.getByRole('button', { name: /^발행$/ }).last()
        await publishText.click({ timeout: 5000 })
      }

      // 결과 URL 대기 — blog.naver.com/{blogId}/{postId}
      const resultUrl = await Promise.race([
        page
          .waitForURL(new RegExp(`blog\\.naver\\.com/${blogId}/\\d+`), { timeout: 60000 })
          .then(() => page.url()),
        page.waitForTimeout(60000).then(() => null),
      ])

      if (!resultUrl) {
        await safeClose(browser)
        return {
          ok: false,
          errorCode: 'PLATFORM_ERROR',
          errorMessage: '발행 후 포스트 URL 리다이렉트 대기 타임아웃',
        }
      }

      await safeClose(browser)
      return { ok: true, platformUrl: resultUrl }
    } catch (err) {
      await safeClose(browser)
      const message = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        errorCode: /timeout/i.test(message) ? 'NETWORK' : 'PLATFORM_ERROR',
        errorMessage: message,
      }
    }
  }
}

async function waitForEditorFrame(page: Page, timeoutMs = 15000): Promise<Frame | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => f.url().includes('PostWriteForm.naver'))
    if (frame) return frame
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

async function dismissDraftDialog(frame: Frame): Promise<void> {
  const cancel = frame.locator(
    '.se-popup-button-cancel, button[data-log="cnt.cancel"], button.cancel_btn__EaDlq'
  )
  if ((await cancel.count()) > 0) {
    await cancel.first().click({ timeout: 2000 })
  }
}

async function safeClose(browser: Browser | null): Promise<void> {
  try {
    if (browser) await browser.close()
  } catch {
    // noop
  }
}
