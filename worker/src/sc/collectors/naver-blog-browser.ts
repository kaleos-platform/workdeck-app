// 네이버 블로그 성과 수집 — 공개 포스트 DOM 파싱.
// 조회수/공감수/댓글수 세 가지를 수집. 로그인 없이 가능.
//
// 네이버 블로그 포스트 URL 구조:
//   blog.naver.com/{blogId}/{postId}  (outer shell + iframe)
//   blog.naver.com/PostView.naver?blogId={blogId}&logNo={postId}  (실제 본문/통계 페이지)
//
// 변동 높은 DOM 이라 여러 셀렉터 폴백 체인으로 견고성 확보.

import { chromium } from 'playwright'
import type { CollectContext, CollectResult, Collector } from './index.js'

export class NaverBlogBrowserCollector implements Collector {
  readonly name = 'naver-blog-browser'

  async collect(ctx: CollectContext): Promise<CollectResult> {
    if (!ctx.deployment.platformUrl) {
      return {
        ok: false,
        errorCode: 'VALIDATION',
        errorMessage: 'platformUrl 이 없어 스크랩할 대상이 없습니다',
      }
    }

    const match = ctx.deployment.platformUrl.match(/blog\.naver\.com\/([^/?]+)\/(\d+)/)
    if (!match) {
      return {
        ok: false,
        errorCode: 'VALIDATION',
        errorMessage: `네이버 블로그 URL 패턴 불일치: ${ctx.deployment.platformUrl}`,
      }
    }
    const blogId = match[1]!
    const postId = match[2]!

    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
    try {
      browser = await chromium.launch({
        headless: process.env.SC_NAVER_HEADLESS !== 'false',
      })
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: 'ko-KR',
      })
      const page = await context.newPage()

      const viewUrl = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${encodeURIComponent(postId)}`
      await page.goto(viewUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)

      const scraped = await page.evaluate(() => {
        function parseIntSafe(v: string | null | undefined): number | null {
          if (!v) return null
          const num = v.replace(/[^0-9]/g, '')
          if (!num) return null
          const n = Number(num)
          return Number.isFinite(n) ? n : null
        }
        function tryAll(selectors: string[]): number | null {
          for (const sel of selectors) {
            const el = document.querySelector(sel)
            if (el) {
              const parsed = parseIntSafe(el.textContent)
              if (parsed !== null) return parsed
            }
          }
          return null
        }

        const views = tryAll(['.se-view-counter em', '.pcol2 em', '.blog2_item .cnt em', '.pcol2'])
        const likes = tryAll(['.u_cnt._count', 'em.u_cnt._count', '.like_cnt em'])
        const comments = tryAll([
          '#commentCount',
          '.u_cbox_count',
          '.btn_comment em',
          '.btn_cmt em',
        ])
        return { views, likes, comments }
      })

      await browser.close()

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      return {
        ok: true,
        metrics: [
          {
            date: today,
            views: scraped.views ?? undefined,
            likes: scraped.likes ?? undefined,
            comments: scraped.comments ?? undefined,
          },
        ],
      }
    } catch (err) {
      try {
        if (browser) await browser.close()
      } catch {
        // noop
      }
      const message = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        errorCode: /timeout|ENOTFOUND/i.test(message) ? 'NETWORK' : 'PLATFORM_ERROR',
        errorMessage: message,
      }
    }
  }
}
