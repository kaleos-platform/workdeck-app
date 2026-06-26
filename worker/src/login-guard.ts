/**
 * 쿠팡 로그인 실패 분류 + 자동 로그인 쿨다운 (공통)
 *
 * 배경(2026-06-26): 쿠팡 비밀번호가 외부에서 변경되면 워커에 저장된 옛 비번으로
 * 로그인이 반복 실패("아이디 또는 비밀번호가 다릅니다") → 자동화 지문 + 반복 실패가
 * Akamai Bot Manager 를 자극해 "Access Denied" 하드 차단으로 격상된다. 그런데
 * scheduled 경로(runCollection)는 실패 시 Slack 알림이 없어서 비번 만료를 몇 시간씩
 * 모르는 운영 갭이 있었다.
 *
 * 이 모듈은:
 *  1) 실패 페이지를 보고 사유를 분류(자격증명 불일치 vs Akamai 봇차단)해 LoginError 로
 *     던진다 → 알림이 "비밀번호 갱신 필요"처럼 구체적으로 안내할 수 있다.
 *  2) 봇차단/자격증명오류 감지 시 "자동(scheduled/backfill/inventory) 로그인"을 잠시
 *     쿨다운한다 → 막힌 상태에서 30초마다 재로그인해 Akamai 차단을 악화시키지 않는다.
 *     단, manual(사용자 직접 트리거)은 쿨다운을 우회한다 — 사용자가 비번을 고친 뒤
 *     즉시 재시도하는 정상 흐름이기 때문. manual 이 성공하면 쿨다운을 해제한다.
 *  3) 같은 사유의 Slack 알림이 매 폴링마다 도배되지 않도록 디듀프한다.
 */
import type { Page } from 'playwright'

export type LoginFailureReason = 'CREDENTIAL_INVALID' | 'BOT_BLOCKED' | 'UNKNOWN'

/** 로그인 실패를 사유와 함께 표현하는 에러. orchestrator 가 reason 으로 분기한다. */
export class LoginError extends Error {
  readonly reason: LoginFailureReason
  constructor(reason: LoginFailureReason, message: string) {
    super(message)
    this.name = 'LoginError'
    this.reason = reason
  }
}

/** 사람이 읽는 사유 라벨 */
export function reasonLabel(reason: LoginFailureReason): string {
  switch (reason) {
    case 'CREDENTIAL_INVALID':
      return '아이디/비밀번호 불일치 (비밀번호 변경·만료 의심)'
    case 'BOT_BLOCKED':
      return 'Akamai 봇 차단 (Access Denied)'
    default:
      return '사유 불명'
  }
}

/**
 * 로그인이 실패한(여전히 login/sso URL) 페이지 내용을 보고 사유를 분류한다.
 * 페이지가 이미 닫혔거나 읽기 실패하면 UNKNOWN.
 */
export async function classifyLoginFailure(page: Page): Promise<LoginFailureReason> {
  let body = ''
  try {
    // innerText 가 가장 신뢰도 높지만 닫힌 페이지에서 throw 할 수 있어 content() 폴백.
    body = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    if (!body) body = await page.content().catch(() => '')
  } catch {
    return 'UNKNOWN'
  }
  const url = (() => {
    try {
      return page.url()
    } catch {
      return ''
    }
  })()
  const haystack = `${url}\n${body}`

  // Akamai WAF 하드 차단 — "Access Denied" + edgesuite(=Akamai) 레퍼런스 페이지
  if (/Access Denied|edgesuite\.net|don't have permission|Reference\s*#\d/i.test(haystack)) {
    return 'BOT_BLOCKED'
  }
  // 쿠팡 앱 레벨 자격증명 거부
  if (
    /아이디 또는 비밀번호|비밀번호가 다릅|존재하지 않는 아이디|아이디를 다시 확인|로그인 정보가 일치/.test(
      haystack
    )
  ) {
    return 'CREDENTIAL_INVALID'
  }
  return 'UNKNOWN'
}

// ─── 자동 로그인 쿨다운 ───────────────────────────────────────────────────────
// 자동(scheduled/backfill/inventory) 경로가 막힌 상태에서 재로그인 난사하는 것을 막는다.

const COOLDOWN_MS: Record<LoginFailureReason, number> = {
  BOT_BLOCKED: 60 * 60 * 1000, // Akamai 차단은 길게 — 쿨다운 동안 자동 재시도 정지
  CREDENTIAL_INVALID: 30 * 60 * 1000, // 비번이 틀린 채로 두드려봐야 무의미 + 락 위험
  UNKNOWN: 10 * 60 * 1000,
}

let cooldownUntil = 0
let cooldownReason: LoginFailureReason | null = null

/** 자동 로그인 쿨다운 진입 */
export function startLoginCooldown(reason: LoginFailureReason): void {
  const until = Date.now() + (COOLDOWN_MS[reason] ?? COOLDOWN_MS.UNKNOWN)
  // 더 늦은 만료로만 연장(짧은 사유가 긴 쿨다운을 줄이지 않게)
  if (until > cooldownUntil) {
    cooldownUntil = until
    cooldownReason = reason
  }
}

/** 쿨다운 해제 (manual 성공 등 정상 복구 시) */
export function clearLoginCooldown(): void {
  cooldownUntil = 0
  cooldownReason = null
}

/** 현재 쿨다운 상태 */
export function getLoginCooldown(): {
  active: boolean
  reason: LoginFailureReason | null
  remainingMs: number
} {
  const remainingMs = Math.max(0, cooldownUntil - Date.now())
  return { active: remainingMs > 0, reason: cooldownReason, remainingMs }
}

// ─── 알림 디듀프 ──────────────────────────────────────────────────────────────
// 같은 사유의 로그인 실패 알림이 매 폴링(30초)마다 Slack 에 도배되지 않게.

const ALERT_DEDUPE_MS = 30 * 60 * 1000
const lastAlertAt: Partial<Record<LoginFailureReason, number>> = {}

/** 이 사유로 지금 알림을 보내도 되는지(디듀프 창 밖인지) */
export function shouldAlertLoginFailure(reason: LoginFailureReason): boolean {
  const now = Date.now()
  const last = lastAlertAt[reason] ?? 0
  if (now - last < ALERT_DEDUPE_MS) return false
  lastAlertAt[reason] = now
  return true
}
