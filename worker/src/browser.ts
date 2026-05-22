/**
 * Playwright + stealth 브라우저 런처 (공통 모듈)
 *
 * 쿠팡 Akamai WAF가 headless 트래픽을 차단하기 시작해서(2026-05-10 즈음)
 * `playwright-extra` + `puppeteer-extra-plugin-stealth`로 봇 탐지 회피한다.
 *
 * 사용처:
 * - worker/src/collector.ts (광고센터)
 * - worker/src/inventory-collector.ts (Wing 재고)
 */
import { chromium as chromiumExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { BrowserContext, LaunchOptions } from 'playwright'

// stealth plugin은 module-load 시 1회만 적용
let stealthApplied = false
function ensureStealth() {
  if (stealthApplied) return
  chromiumExtra.use(StealthPlugin())
  stealthApplied = true
}

export type LaunchPersistentOptions = {
  userDataDir: string
  headless: boolean
  acceptDownloads?: boolean
  locale?: string
  timezoneId?: string
  viewport?: { width: number; height: number }
  userAgent?: string
}

/**
 * persistent context를 stealth 적용해서 띄운다.
 * 기존 `chromium.launchPersistentContext(...)`의 drop-in 대체.
 */
export async function launchStealthPersistentContext(
  opts: LaunchPersistentOptions
): Promise<BrowserContext> {
  ensureStealth()

  const launchOptions: LaunchOptions & { args?: string[]; channel?: string } = {
    headless: opts.headless,
    // 시스템 Chrome Stable 사용 — Akamai TLS/HTTP2 fingerprint가
    // Playwright 번들 Chromium 보다 우회력 ↑.
    // 미설치 환경(CI 등)에서는 CHROME_CHANNEL=chromium 으로 우회 가능.
    channel: process.env.CHROME_CHANNEL || 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  }

  // playwright-extra의 chromium은 launchPersistentContext도 그대로 노출
  const context = await chromiumExtra.launchPersistentContext(opts.userDataDir, {
    ...launchOptions,
    acceptDownloads: opts.acceptDownloads ?? true,
    locale: opts.locale ?? 'ko-KR',
    timezoneId: opts.timezoneId ?? 'Asia/Seoul',
    viewport: opts.viewport ?? { width: 1400, height: 900 },
    userAgent: opts.userAgent,
  })

  return context
}
