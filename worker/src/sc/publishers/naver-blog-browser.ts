// 네이버 블로그 브라우저 자동화 퍼블리셔 — Playwright storageState 기반.
// SmartEditor ONE (v4) 대응. 흐름:
//   1) chromium + storageState 로드 + navigator.webdriver 스푸핑 (addInitScript)
//   2) /{blogId}?Redirect=Write 이동 → iframe(PostWriteForm.naver) 대기
//   3) 임시저장 팝업 있으면 취소
//   4) 제목 영역 클릭 → keyboard.type(title)
//   5) 본문 영역 클릭 → paragraph 별 keyboard.type + Enter
//   6) 발행 버튼 클릭 (iframe DOM click) → 설정 팝업 오픈 → 최종 발행 (iframe DOM click)
//   7) post URL 이 https://blog.naver.com/{blogId}/{postId} 로 리다이렉트되면 성공
//
// 세션 만료(로그인 페이지로 튕김) 시 AUTH_FAILED 반환.
// DOM 변경·타임아웃 시 PLATFORM_ERROR.
//
// 주의사항 (실 발행 E2E 로 확정된 제약):
//   - 발행/최종발행 버튼 모두 Playwright locator.click() 은 사용하지 않는다.
//     iframe 내 se-help-layer("모바일 화면 미리보기") 가 좌표상 overlay 로 click 을 가로채
//     SmartEditor 의 React onClick 이 trigger 되지 않는 경우가 있음 → iframe DOM click 사용.
//   - publish modal 이 열린 뒤 ESC 를 누르면 modal 이 닫힌다.
//     따라서 modal open 후에는 fallback ESC 로직을 실행하지 않는다.

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
      })
      const context = await browser.newContext({
        storageState: storageState as never,
        viewport: { width: 1280, height: 900 },
        locale: 'ko-KR',
      })
      // navigator.webdriver 스푸핑 — 네이버 SmartEditor 의 발행 버튼 onClick 이 이 값을 확인하고
      // 자동화 탐지 시 모달을 열지 않고 silent no-op 하는 것으로 확인됨.
      // trace-publish.ts 와 동일한 init script 를 Publisher 에도 적용.
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })

      const page = await context.newPage()
      const writeUrl = `https://blog.naver.com/${blogId}?Redirect=Write`
      await page.goto(writeUrl, { waitUntil: 'domcontentloaded' })

      // 세션 만료 감지 + 에디터 풀로드 대기
      await page.waitForTimeout(5000)
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

      // 본문 입력 완료 후 짧은 대기 — SmartEditor 자동저장 debounce 안정화.
      await page.waitForTimeout(400)

      // 포커스 해제 — 도움말 오버레이 닫기 + 에디터 상태 고정.
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)

      // 발행 버튼 (툴바). iframe 내부 DOM click 으로 React onClick 을 트리거.
      const publishClicked = await editorFrame.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>('button.publish_btn__m9KHH')
        if (!btn) return false
        btn.click()
        return true
      })
      if (!publishClicked) {
        await safeClose(browser)
        return {
          ok: false,
          errorCode: 'PLATFORM_ERROR',
          errorMessage: '툴바 발행 버튼을 찾지 못했습니다.',
        }
      }

      // 설정 팝업(layer_publish__{해시}) 오픈 대기.
      const popupDialog = editorFrame.locator(
        '[class^="layer_publish"], [class*=" layer_publish"], [class^="layer_content_set_publish"]'
      )
      const popupOpened = await popupDialog
        .first()
        .waitFor({ state: 'visible', timeout: 10000 })
        .then(() => true)
        .catch(() => false)
      if (!popupOpened) {
        await safeClose(browser)
        return {
          ok: false,
          errorCode: 'PLATFORM_ERROR',
          errorMessage: '발행 설정 팝업이 오픈되지 않았습니다.',
        }
      }

      // 최종 발행 — 모달 내 confirm 버튼. Playwright locator.click 은 iframe 내 se-help-layer
      // overlay 에 가로채일 수 있어 iframe DOM click 을 사용.
      const finalClicked = await editorFrame.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>(
          'button[data-click-area="tpb*i.publish"]'
        )
        if (!btn) return false
        btn.click()
        return true
      })
      if (!finalClicked) {
        await safeClose(browser)
        return {
          ok: false,
          errorCode: 'PLATFORM_ERROR',
          errorMessage: '최종 발행 버튼(tpb*i.publish)을 찾지 못했습니다.',
        }
      }

      // 결과 URL 대기 — blog.naver.com/{blogId}/{postId}
      const resultUrl = await page
        .waitForURL(new RegExp(`blog\\.naver\\.com/${blogId}/\\d+`), { timeout: 60000 })
        .then(() => page.url())
        .catch(() => null)

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
