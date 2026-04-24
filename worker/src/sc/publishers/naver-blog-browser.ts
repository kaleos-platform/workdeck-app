// 네이버 블로그 브라우저 자동화 퍼블리셔 — Playwright storageState 기반.
// SmartEditor ONE (v4) 대응. 흐름:
//   1) chromium + storageState 로드
//   2) /{blogId}?Redirect=Write 이동 → iframe(PostWriteForm.naver) 대기
//   3) 임시저장 팝업 있으면 취소
//   4) 제목 영역 클릭 → keyboard.type(title)
//   5) 본문 영역 클릭 → paragraph 별 keyboard.type + Enter
//   6) 발행 버튼 클릭 → 설정 팝업 → 최종 발행
//   7) post URL 이 https://blog.naver.com/{blogId}/{postId} 로 리다이렉트되면 성공
//
// 세션 만료(로그인 페이지로 튕김) 시 AUTH_FAILED 반환.
// DOM 변경·타임아웃 시 PLATFORM_ERROR.
//
// ⚠️ 알려진 이슈 (추가 조사 필요):
//   SmartEditor 의 발행 버튼 클릭 후 설정 모달이 간헐적으로 오픈되지 않는 경우가 있음.
//   동일 플로우를 standalone 스크립트(scripts/sc/_debug/trace-publish.ts)로 돌리면
//   모달이 정상 오픈되지만, 이 class 경유 flow 에서는 재현이 어려움.
//   워커라운드: 한 번 실패 시 DOM click 재시도 2회 수행.
//   근본 원인(에디터 자동저장 타이밍? context 재사용 이슈?)은 follow-up 에서 특정.

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

      // 에디터 저장 상태 안정화 대기 — SmartEditor 는 debounce 기반 자동저장을 수행하고
      // 그 동안 발행 버튼이 내부적으로 disabled 가 아니지만 onClick 핸들러가 소극적으로 반응.
      await page.waitForTimeout(2500)

      // 포커스 해제 — ESC 후 에디터 상태 고정
      await page.keyboard.press('Escape')
      await page.waitForTimeout(800)

      // 발행 버튼 (툴바) — 2회 재시도 전략: Playwright click 실패 시 DOM click
      const pubBtn = editorFrame.locator('button.publish_btn__m9KHH').first()
      await pubBtn.click({ force: true, timeout: 10000 })
      await page.waitForTimeout(3000)

      // 모달이 열리지 않으면 한 번 더 DOM click 재시도 (간헐적 실패 워커라운드)
      const modalOpen = await editorFrame
        .locator('[class^="layer_publish"], [class^="layer_content_set_publish"]')
        .first()
        .isVisible()
        .catch(() => false)
      if (!modalOpen) {
        await editorFrame.evaluate(`document.querySelector('button.publish_btn__m9KHH')?.click()`)
        await page.waitForTimeout(3000)
      }

      // 설정 팝업 진입 대기 — 실제 class 는 layer_publish__{해시} 로 suffix 붙음
      const popupDialog = editorFrame.locator(
        '[class^="layer_publish"], [class*=" layer_publish"], [class^="layer_content_set_publish"]'
      )
      await popupDialog
        .first()
        .waitFor({ state: 'visible', timeout: 10000 })
        .catch(() => {
          // 팝업 못 찾아도 일단 다음 단계 시도
        })

      // 팝업 내 도움말 해제
      await dismissHelpOverlay(editorFrame, page).catch(() => {})

      // 최종 발행 — 모달 내 confirm 버튼 (Playwright click, force:true 로 overlay 통과)
      const confirmBtn = editorFrame.locator('button[data-click-area="tpb*i.publish"]').first()
      let finalClicked: string | null = null
      if ((await confirmBtn.count()) > 0) {
        try {
          await confirmBtn.click({ force: true, timeout: 8000 })
          finalClicked = 'data-click-area'
        } catch (e) {
          finalClicked = null
        }
      }
      if (!finalClicked) {
        const diag = await editorFrame.evaluate(
          `(() => {
            const modals = document.querySelectorAll('[class^="layer_publish"], [class^="layer_content_set_publish"]');
            const confirmBtns = document.querySelectorAll('[class^="confirm_btn"], button[data-click-area*="publish"]');
            return {
              modalCount: modals.length,
              modalVisible: Array.from(modals).filter(m => m.offsetWidth > 100 && m.offsetHeight > 100).length,
              confirmBtnCount: confirmBtns.length,
              confirmBtnTexts: Array.from(confirmBtns).slice(0, 5).map(b => (b.textContent || '').trim() + '|' + b.getAttribute('data-click-area')),
            };
          })()`
        )
        await safeClose(browser)
        return {
          ok: false,
          errorCode: 'PLATFORM_ERROR',
          errorMessage: `최종 발행 버튼을 찾지 못했습니다 — diag: ${JSON.stringify(diag)}`,
        }
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

async function dismissHelpOverlay(frame: Frame, page: Page): Promise<void> {
  // se-help-title 근처의 close 버튼 후보들
  const helpClose = frame.locator(
    '.se-help-title ~ .se-help-close, .se-help-close-button, button[data-log="hlp.close"], .container__HW_tc button[aria-label*="닫기"]'
  )
  if ((await helpClose.count()) > 0) {
    await helpClose
      .first()
      .click({ timeout: 2000 })
      .catch(() => {})
    await page.waitForTimeout(500)
    return
  }
  // fallback — ESC 키
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
}

async function safeClose(browser: Browser | null): Promise<void> {
  try {
    if (browser) await browser.close()
  } catch {
    // noop
  }
}
