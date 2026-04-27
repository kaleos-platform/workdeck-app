#!/usr/bin/env tsx
/**
 * 네이버 블로그 Playwright 세션 획득 스크립트.
 *
 * 두 가지 모드:
 *   --auto   : NAVER_ID / NAVER_PW 환경변수로 자동 로그인 (클립보드 paste 방식)
 *   --manual : chromium headful 로 띄우고 사용자가 직접 로그인, 세션 쿠키 감지되면 저장
 *
 * 실행 예시:
 *   NAVER_ID=abc NAVER_PW=xyz npx tsx scripts/sc/acquire-naver-session.ts \
 *     --auto --out /tmp/naver-session.json
 *
 *   npx tsx scripts/sc/acquire-naver-session.ts --manual --out /tmp/naver-session.json
 *
 * 보안: 획득한 storageState 는 민감 쿠키(NID_AUT/NID_SES) 를 포함.
 * /tmp 등 휘발 경로에만 저장하고 git 커밋 금지.
 */
import { chromium, type Page } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const outFlagIdx = args.indexOf('--out')
const outPath = outFlagIdx >= 0 ? args[outFlagIdx + 1] : '/tmp/naver-session.json'
const mode: 'auto' | 'manual' = args.includes('--manual') ? 'manual' : 'auto'

if (!outPath) {
  console.error('--out <path> 가 필요합니다')
  process.exit(1)
}

const NAVER_ID = process.env.NAVER_ID
const NAVER_PW = process.env.NAVER_PW
if (mode === 'auto' && (!NAVER_ID || !NAVER_PW)) {
  console.error('--auto 모드에서는 NAVER_ID / NAVER_PW 환경변수가 필요합니다.')
  process.exit(1)
}

const MAX_WAIT_SEC = Number(process.env.ACQUIRE_MAX_WAIT_SEC ?? 300)
const POLL_INTERVAL_MS = 2000

async function waitUntilLoggedIn(
  cookies: () => Promise<Array<{ name: string }>>
): Promise<boolean> {
  const deadline = Date.now() + MAX_WAIT_SEC * 1000
  while (Date.now() < deadline) {
    const list = await cookies()
    const hasAuth = list.some((c) => c.name === 'NID_AUT')
    const hasSes = list.some((c) => c.name === 'NID_SES')
    if (hasAuth && hasSes) return true
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  return false
}

// 네이버 로그인 페이지의 id/pw 인풋은 클립보드 paste 를 가장 덜 감지.
async function pasteViaClipboard(page: Page, selector: string, value: string) {
  await page.click(selector)
  // clipboard API 접근이 제한적이므로 document.execCommand 을 활용
  await page.evaluate(
    ({ sel, v }) => {
      const el = document.querySelector<HTMLInputElement>(sel)
      if (!el) return
      el.focus()
      // Naver 의 input 은 React 제어 컴포넌트일 수 있어 native setter 사용
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      nativeSetter?.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.dispatchEvent(new Event('blur', { bubbles: true }))
    },
    { sel: selector, v: value }
  )
}

async function autoLogin(page: Page) {
  await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#id', { timeout: 15000 })
  await page.waitForTimeout(800 + Math.random() * 600)
  await pasteViaClipboard(page, '#id', NAVER_ID!)
  await page.waitForTimeout(400 + Math.random() * 400)
  await pasteViaClipboard(page, '#pw', NAVER_PW!)
  await page.waitForTimeout(500 + Math.random() * 500)
  // 제출: Enter 가 봇 감지를 덜 타는 편
  await page.press('#pw', 'Enter')
}

async function main() {
  console.log(`[acquire-naver-session] mode=${mode}, out=${outPath}`)
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
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

  if (mode === 'auto') {
    console.log('[acquire-naver-session] auto 로그인 시도')
    await autoLogin(page)
  } else {
    console.log('[acquire-naver-session] 수동 로그인 모드 — 브라우저에서 직접 로그인하세요')
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' })
  }

  console.log(`[acquire-naver-session] 로그인 쿠키(NID_AUT/NID_SES) 대기 — 최대 ${MAX_WAIT_SEC}초`)
  const loggedIn = await waitUntilLoggedIn(() => context.cookies())
  if (!loggedIn) {
    console.error(`⚠️ ${MAX_WAIT_SEC}초 안에 로그인 세션이 감지되지 않았습니다.`)
    console.error('    현재 URL:', page.url())
    console.error('    화면에 캡챠/보안문자가 있으면 브라우저에서 수동 해결 후 저장됩니다.')
    console.error('    --manual 모드로 재시도해보세요.')
    await browser.close()
    process.exit(2)
  }

  await page.goto('https://blog.naver.com', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1500)

  const cookies = await context.cookies()
  console.log(`[acquire-naver-session] ✓ 로그인 성공. 쿠키 ${cookies.length}개 확보`)

  const state = await context.storageState()
  mkdirSync(dirname(outPath!), { recursive: true })
  writeFileSync(outPath!, JSON.stringify(state, null, 2), { mode: 0o600 })
  console.log(`[acquire-naver-session] ✓ storageState 저장: ${outPath}`)

  await browser.close()
}

main().catch((err) => {
  console.error('[acquire-naver-session] error:', err)
  process.exit(1)
})
