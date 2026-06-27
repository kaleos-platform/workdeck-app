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
import {
  existsSync,
  lstatSync,
  readlinkSync,
  rmSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'node:fs'
import { join, dirname, basename } from 'node:path'

// stealth plugin은 module-load 시 1회만 적용
let stealthApplied = false
function ensureStealth() {
  if (stealthApplied) return
  chromiumExtra.use(StealthPlugin())
  stealthApplied = true
}

// ─── 세션 재사용 (storageState 저장/복원) ──────────────────────────────────────
// 쿠팡 인증 쿠키(KEYCLOAK_IDENTITY/JSESSIONID 등)는 session-scoped(만료 없음)라
// context.close() + 다음 clean launch 때 Chromium 이 퍼지한다 → 영속 프로파일인데도
// 매 수집마다 풀 로그인(하루 ~52회) → Akamai 봇탐지 노출 표면 증가(반복 로그인이
// "Access Denied" 격상의 연료). 해결: 성공 세션의 storageState 를 저장하고 다음 launch
// 때 "session 쿠키만" 복원한다. 영속 Akamai 쿠키(_abck/bm_*)는 프로파일이 이미
// 보존하므로 제외 — 스테일 봇지문 재주입 방지. 만료/실패 시 isLoggedIn=false →
// performLogin fallback 이라 저위험(최악도 오늘과 동일).

// 로그인 "성공" 을 증명하는 쿠키 — Keycloak SSO 가 인증을 마쳐야 발급하는 IDENTITY 쿠키.
// 주의: AUTH_SESSION_ID 는 로그인 페이지를 "열기만" 해도 생기는 인증-플로우 쿠키라
// 실패한 로그인에도 존재한다 → 게이트로 쓰면 실패 세션까지 저장된다(검증으로 확인).
// 그래서 저장 게이트는 KEYCLOAK_IDENTITY(성공에만 존재, 실패엔 부재) 로만 판단한다.
const AUTHED_COOKIE_NAMES = ['KEYCLOAK_IDENTITY', 'KEYCLOAK_IDENTITY_LEGACY']
// 세션이 이보다 오래되면 서버측에서 만료됐을 가능성이 높아 복원 생략(어차피 fallback).
const SESSION_MAX_AGE_MS = 10 * 60 * 60 * 1000

// storageState().cookies 의 직렬화 형태 (JSON 파일에서 읽음).
type StoredCookie = {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

function sessionFilePath(userDataDir: string): string {
  // 프로파일 디렉토리 밖(부모)에 둬 preflightCleanupProfile 의 정리 대상과 분리.
  return join(dirname(userDataDir), `.session-${basename(userDataDir)}.json`)
}

/** 직전 성공 세션의 session-scoped 쿠키를 새 context 에 복원해 재로그인을 회피한다. */
async function restoreSessionCookies(context: BrowserContext, userDataDir: string): Promise<void> {
  try {
    const file = sessionFilePath(userDataDir)
    if (!existsSync(file)) return
    if (Date.now() - statSync(file).mtimeMs > SESSION_MAX_AGE_MS) return
    const state = JSON.parse(readFileSync(file, 'utf8')) as { cookies?: StoredCookie[] }
    // Chromium 이 clean launch 때 퍼지하는 건 session 쿠키(expires<=0)뿐 → 그것만 재주입.
    const sessionCookies = (state.cookies ?? []).filter((c) => c.expires == null || c.expires <= 0)
    if (sessionCookies.length === 0) return
    await context.addCookies(sessionCookies as Parameters<BrowserContext['addCookies']>[0])
    console.log(`[browser] 세션 쿠키 복원 (${sessionCookies.length}개) — 재로그인 회피 시도`)
  } catch {
    /* 복원 실패 — performLogin fallback */
  }
}

/** 현재 context 가 인증돼 있으면 storageState 를 저장한다(다음 launch 재사용). */
export async function saveSessionCookies(
  context: BrowserContext,
  userDataDir: string
): Promise<void> {
  try {
    const state = await context.storageState()
    const authed = state.cookies.some((c) => AUTHED_COOKIE_NAMES.includes(c.name))
    if (!authed) return // 로그인 실패(IDENTITY 부재) — 스테일 플로우 쿠키로 좋은 세션 덮어쓰기 금지
    writeFileSync(sessionFilePath(userDataDir), JSON.stringify(state), { mode: 0o600 })
    console.log('[browser] 세션 저장 — 다음 수집에서 재사용')
  } catch {
    /* storageState 실패(브라우저 사망 등) — 무시 */
  }
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

// 락 핸들 — release(정상 해제) + renew(idle 타임아웃 갱신).
export type ProfileLock = {
  release: () => void
  /** 진행 중임을 알려 idle 타임아웃을 리셋한다. 장시간 op(백필)가 주기적으로 호출. */
  renew: () => void
}

// 한 회차가 비정상으로 락을 안 풀면(영구 hang) 다음 회차가 무한 대기 → 워커 전체
// 데드락. 백스톱으로, "마지막 활동 후" 일정 시간 활동이 없으면(=진짜 hang) 강제
// 해제해 체인을 회복시킨다.
//
// ⚠️ 과거 버그(2026-06-07 백필 크래시): 이 타임아웃이 "보유 시작 후" 절대 시간
// 기준이라, 90일 백필(수십 분)처럼 정상이지만 오래 걸리는 op 를 hang 으로 오판해
// 강제 해제 → 같은 프로파일에 두 번째 op 가 launch → 그 preflight pkill 이 살아있는
// 백필 Chrome 을 죽임 → "browser closed" 연쇄. 그래서 절대 시간 → idle(무활동)
// 시간 기준으로 전환하고, 장시간 op 는 renew() 로 살아있음을 알린다.
const LOCK_IDLE_TIMEOUT = 12 * 60 * 1000

function acquireProfileLock(userDataDir: string): Promise<ProfileLock> {
  let release!: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  const prev = profileLockChain
  profileLockChain = profileLockChain.then(() => next)
  return prev.then(() => {
    let chainReleased = false
    let timer: ReturnType<typeof setTimeout>

    // 체인 해제(다음 op 진행) — 정상/강제 공통. 한 번만.
    //
    // ⚠️ force-release(idle 타임아웃)는 "12분간 health 신호(renew) 없음 = 진짜 hang"
    // 으로 간주한다. 이 경우 다음 op 의 preflight 가 hung Chrome 을 정리(pkill)할 수
    // 있어야 데드락/SingletonLock 루프에서 회복된다(2026-06-07 09:00 cron 수정의 핵심).
    // healthy 장시간 op(백필 ~60분)는 날짜마다 renew 하므로 절대 force-release 되지
    // 않고, 따라서 형제 op 와 겹치지 않는다 → 살아있는 백필 Chrome 이 죽는 일 없음.
    // renew 가 유일한 health 신호이므로 별도 "활성 홀더 가드"는 불필요.
    const releaseChain = (forced: boolean) => {
      if (chainReleased) return
      chainReleased = true
      clearTimeout(timer)
      if (forced) {
        console.error('[browser] 프로파일 락 idle 타임아웃 — 강제 해제 (12분 무활동, hang 의심)')
      }
      release()
    }

    const armTimer = () => {
      timer = setTimeout(() => releaseChain(true), LOCK_IDLE_TIMEOUT)
      if (typeof timer.unref === 'function') timer.unref()
    }

    armTimer()

    return {
      release: () => releaseChain(false),
      renew: () => {
        if (chainReleased) return
        clearTimeout(timer)
        armTimer()
      },
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

  // 이 프로파일을 쓰는 Chrome 프로세스를 kill 한다.
  // mutex 안에서만 호출되므로 정상 경로에선 진행 중 형제가 없고, 남아 있는 건 항상
  // 이전 회차의 leak 잔류. 락 파일 유무와 무관하게 죽이는 이유: close 가 락만 지우고
  // 프로세스를 못 죽인 엣지(lockPid=0 인데 live orphan 존재)도 닫기 위함.
  // user-data-dir 매칭이라 node 워커 본체는 절대 안 걸린다.
  //
  // mutex(renew 기반 idle 타임아웃)가 보장: 정상 경로에선 여기 도달 시 형제 op 가
  // 없다. force-release 는 12분 무활동(=hang)일 때만 일어나며, 그 경우 hung Chrome
  // 정리가 바로 이 pkill 의 목적이다. healthy 장시간 op 는 renew 로 force-release 를
  // 피하므로 이 pkill 에 살아있는 형제가 걸릴 일은 없다.
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
  const lock = await acquireProfileLock(opts.userDataDir)

  // launch 직전 프로파일 셀프-힐 (stale/leak lock 제거 — 무인 cron 안정).
  // mutex 안에서 호출하므로, 정상 경로에선 여기서 정리되는 점유 Chrome 은 항상 이전
  // 회차의 leak 잔류이지 진행 중 형제가 아니다.
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
    lock.release() // launch 실패 시에도 mutex 반드시 해제 (안 하면 워커 영구 데드락)
    throw err
  }

  // 장시간 op(백필)가 진행 중임을 알려 idle 타임아웃을 갱신하도록 renew 노출.
  // drop-in 유지를 위해 context 에 비표준 프로퍼티로 attach 한다.
  ;(context as BrowserContext & { renewProfileLock?: () => void }).renewProfileLock = lock.renew

  // context.close() 시 mutex 해제 — 호출자는 finally 에서 close 만 하면 된다.
  // close 가 EPERM 등으로 실패해도(과거 leak 원인) 락은 반드시 풀린다.
  let released = false
  const releaseOnce = () => {
    if (released) return
    released = true
    lock.release()
  }
  const origClose = context.close.bind(context)
  context.close = async (...args: Parameters<typeof origClose>) => {
    // 닫기 전에 인증 세션 저장 — 브라우저가 살아있을 때만 storageState 가능하므로.
    await saveSessionCookies(context, opts.userDataDir).catch(() => {})
    try {
      return await origClose(...args)
    } finally {
      releaseOnce()
    }
  }
  // close 없이 프로세스가 죽는 비정상 경로 대비 — disconnect 시에도 해제
  context.on('close', releaseOnce)

  // 직전 성공 세션 복원 — isLoggedIn 이 true 가 되면 풀 로그인을 건너뛴다(Akamai 노출↓).
  await restoreSessionCookies(context, opts.userDataDir)

  return context
}

/**
 * 장시간 작업(백필 등)이 진행 중임을 알려 프로파일 락 idle 타임아웃을 갱신한다.
 * 해당 context 가 launchStealthPersistentContext 로 만들어졌으면 락을 renew 하고,
 * 아니면 no-op. 호출자는 작업 단위(예: 날짜 하나 처리)마다 호출하면 된다.
 */
export function renewProfileLock(context: BrowserContext): void {
  const fn = (context as BrowserContext & { renewProfileLock?: () => void }).renewProfileLock
  if (typeof fn === 'function') fn()
}
