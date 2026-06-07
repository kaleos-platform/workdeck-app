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
import { execSync } from 'node:child_process'
import { existsSync, lstatSync, readlinkSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
 * 프로파일 mutex — cron / manual-poller / backfill-poller 가 같은 `.browser-data`
 * 프로파일에 동시에 launch 하면 SingletonLock 충돌이 난다. 각 스케줄러는 자기
 * `isProcessing` 만 보고 서로를 모르므로, launch chokepoint 에서 직렬화한다.
 * 한 collection 이 끝날(context.close()) 때까지 다음 launch 는 대기.
 */
let profileLockChain: Promise<void> = Promise.resolve()
// 한 회차가 비정상으로 락을 안 풀면(영구 hang) 다음 회차가 무한 대기 → 워커 전체
// 데드락. 백스톱으로, 일정 시간 이상 hold 된 락은 강제 해제해 체인을 회복시킨다.
// collection 한 회차는 길어도 ~6분이므로 여유 있게 12분.
const LOCK_HOLD_TIMEOUT = 12 * 60 * 1000
function acquireProfileLock(): Promise<() => void> {
  let release!: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  const prev = profileLockChain
  profileLockChain = profileLockChain.then(() => next)
  return prev.then(() => {
    // 호출자가 release 를 잊거나 hang 해도 타임아웃에 자동 해제 → 체인 회복
    const timer = setTimeout(() => {
      console.error('[browser] 프로파일 락 보유 타임아웃 — 강제 해제 (이전 회차 hang 의심)')
      release()
    }, LOCK_HOLD_TIMEOUT)
    if (typeof timer.unref === 'function') timer.unref()
    return () => {
      clearTimeout(timer)
      release()
    }
  })
}

/** pid 살아있나 (kill -0) */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // ESRCH = 없음, EPERM = 존재(타 유저) → 살아있음으로 간주
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * 같은 프로파일을 점유 중인 Chrome 이 남아 있으면 cron/manual 다음 launch 가
 * "Failed to create ProcessSingleton" 으로 즉시 abort 한다
 * (2026-06-07 09:00 cron 실패 원인 — 전날 manual 수집 브라우저가 close 실패로 leak,
 *  EPERM 으로 Playwright graceful close 가 자식을 못 죽여 프로파일 점유 잔류).
 *
 * launch 직전 chokepoint 에서:
 *  1) SingletonLock 의 host-pid 를 파싱해 그 pid 가 죽었으면 stale → 락만 제거
 *  2) pid 가 살아있으면(=leak/orphan) 이 프로파일을 쓰는 Chrome 프로세스를 kill
 *  3) crash 플래그(exit_type)를 Normal 로 돌려 "복원하시겠습니까?" 버블이 자동화를 막지 않게
 *
 * 무인 자동화 안정의 핵심: 매 launch 마다 셀프-힐. 단발 수동 정리에 의존하지 않는다.
 */
function preflightCleanupProfile(userDataDir: string): void {
  const lockPath = join(userDataDir, 'SingletonLock')

  // SingletonLock symlink → "host-pid" 형태
  let lockPid = 0
  try {
    if (existsSync(lockPath) || lstatSync(lockPath).isSymbolicLink()) {
      const target = readlinkSync(lockPath) // 예: kaleos-Macmini.local-10997
      const m = target.match(/-(\d+)$/)
      if (m) lockPid = parseInt(m[1], 10)
    }
  } catch {
    /* 락 없음/읽기 실패 — 계속 진행 */
  }

  const lockAlive = lockPid > 0 && isPidAlive(lockPid)
  if (!lockAlive && lockPid > 0) {
    console.log(`[browser] stale SingletonLock(pid ${lockPid} 죽음) 제거`)
  }

  // 이 프로파일을 쓰는 Chrome 프로세스를 무조건 kill 한다.
  // mutex 안에서만 호출되므로 진행 중 형제는 없고, 남아 있는 건 항상 이전 회차의
  // leak 잔류. 락 파일 유무와 무관하게 죽이는 이유: close 가 락만 지우고 프로세스를
  // 못 죽인 엣지(lockPid=0 인데 live orphan 존재)도 닫기 위함.
  // user-data-dir 매칭이라 node 워커 본체는 절대 안 걸린다.
  try {
    execSync(`pkill -f "user-data-dir=${userDataDir.replace(/"/g, '\\"')}"`, { stdio: 'ignore' })
    console.log('[browser] 프로파일 점유 Chrome 정리 (leak 방지)')
    execSync('sleep 2', { stdio: 'ignore' }) // OS 가 프로세스/소켓 정리할 시간
  } catch {
    /* 점유 프로세스 없음 (pkill exit 1) — 정상 */
  }

  // 락 파일 3종 제거 (살아있던 점유자는 위에서 kill 됨)
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try {
      rmSync(join(userDataDir, name), { force: true })
    } catch {
      /* 무시 */
    }
  }

  // crash 플래그 정리 — "이전 세션 복원" 버블이 뜨면 자동화가 막힌다
  const prefsPath = join(userDataDir, 'Default', 'Preferences')
  try {
    if (existsSync(prefsPath)) {
      const prefs = JSON.parse(readFileSync(prefsPath, 'utf8'))
      const profile = (prefs.profile ??= {})
      if (profile.exit_type !== 'Normal' || profile.exited_cleanly !== true) {
        profile.exit_type = 'Normal'
        profile.exited_cleanly = true
        writeFileSync(prefsPath, JSON.stringify(prefs))
        console.log('[browser] crash 플래그 정리 (exit_type → Normal)')
      }
    }
  } catch {
    /* Preferences 파싱 실패 — 무시 */
  }
}

/**
 * persistent context를 stealth 적용해서 띄운다.
 * 기존 `chromium.launchPersistentContext(...)`의 drop-in 대체.
 */
export async function launchStealthPersistentContext(
  opts: LaunchPersistentOptions
): Promise<BrowserContext> {
  ensureStealth()

  // 동일 프로파일 동시 launch 직렬화 — 진행 중 형제 collection 이 끝날 때까지 대기
  const releaseLock = await acquireProfileLock()

  // launch 직전 프로파일 셀프-힐 (stale/leak lock 제거 — 무인 cron 안정).
  // mutex 안에서 호출하므로, 여기서 정리되는 점유 Chrome 은 항상 이전 회차의
  // leak 잔류이지 진행 중 형제가 아니다.
  preflightCleanupProfile(opts.userDataDir)

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
      // 무인(백그라운드) 실행 시 macOS/Chrome 이 가려진 창의 렌더링을 정지(occlusion
      // throttling)시키면 page.screenshot 가 compositor 프레임을 못 받아 hang 한다
      // (2026-06-05 자동수집 실패 원인 — 로그인은 성공, [2/6] 직후 screenshot timeout).
      // 창이 frontmost 가 아니어도 렌더링을 유지하도록 강제한다.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-features=CalculateNativeWinOcclusion',
    ],
  }

  // playwright-extra의 chromium은 launchPersistentContext도 그대로 노출
  let context: BrowserContext
  try {
    context = await chromiumExtra.launchPersistentContext(opts.userDataDir, {
      ...launchOptions,
      acceptDownloads: opts.acceptDownloads ?? true,
      locale: opts.locale ?? 'ko-KR',
      timezoneId: opts.timezoneId ?? 'Asia/Seoul',
      viewport: opts.viewport ?? { width: 1400, height: 900 },
      userAgent: opts.userAgent,
    })
  } catch (err) {
    releaseLock() // launch 실패 시에도 mutex 반드시 해제 (안 하면 워커 영구 데드락)
    throw err
  }

  // context.close() 시 mutex 해제 — 호출자는 finally 에서 close 만 하면 된다.
  // close 가 EPERM 등으로 실패해도(과거 leak 원인) 락은 반드시 풀린다.
  let released = false
  const releaseOnce = () => {
    if (released) return
    released = true
    releaseLock()
  }
  const origClose = context.close.bind(context)
  context.close = async (...args: Parameters<typeof origClose>) => {
    try {
      return await origClose(...args)
    } finally {
      releaseOnce()
    }
  }
  // close 없이 프로세스가 죽는 비정상 경로 대비 — disconnect 시에도 해제
  context.on('close', releaseOnce)

  return context
}
