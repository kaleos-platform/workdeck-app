/**
 * 월별 잔액 추이 — 월말 현금·부채·순자산과 건전성 지표를 계산하는 순수 함수(단위 테스트 대상).
 * DB I/O는 호출부(queries.ts queryDashboard)에.
 *
 * 규약:
 *  - 현금 = BANK 계좌 월말 스냅샷 합. 그 달 스냅샷이 없으면 직전 스냅샷 이월, 그것도 없으면 openingBalance.
 *    미사용(INACTIVE) 계좌도 합에 포함한다 — 잔액 0일 때만 전환되므로 이후 달 기여는 0, 과거 달은 실제 잔액.
 *  - 부채 = 부채 스냅샷 이월 합. 첫 부채 스냅샷 이전 달은 알 수 없으므로 null('—').
 *  - 이월 경고(carried)는 사용 중(ACTIVE) 계좌만 — 미사용 계좌는 매달 경고가 뜨는 노이즈라 제외.
 */
import { addMonths } from '@/lib/finance/aggregate'
import { round2 } from '@/lib/finance/serialize'

export type YmBalance = { ym: string; balance: number }

/**
 * 계좌의 ym 시점 잔액 — 대시보드 현금 합계와 미사용 전환 게이트가 공유하는 단일 기준.
 * snaps는 ym 오름차순. 최신 잔액이 필요하면 ym에 '9999-12'.
 */
export function accountBalanceAt(
  snaps: readonly YmBalance[] | undefined,
  ym: string,
  openingBalance: number | null
): number {
  return lastAtOrBefore(snaps, ym)?.balance ?? openingBalance ?? 0
}

function lastAtOrBefore(snaps: readonly YmBalance[] | undefined, ym: string): YmBalance | null {
  let found: YmBalance | null = null
  for (const s of snaps ?? []) {
    if (s.ym <= ym) found = s
    else break
  }
  return found
}

export interface BalanceTrendInput {
  /** 표시할 월(오름차순). 미래 달은 호출부에서 제외. */
  months: string[]
  /** 현재 KST 월 — 진행 중 표시·버틸 개월수 창 판정. */
  nowYm: string
  bankAccounts: {
    id: string
    name: string
    status: 'ACTIVE' | 'INACTIVE'
    openingBalance: number | null
  }[]
  /** accountId → 월말 스냅샷(ym 오름차순) */
  accountSnaps: Map<string, YmBalance[]>
  /** 부채 스냅샷(ym 오름차순) */
  liabilitySnaps: { liabilityId: string; name: string; ym: string; balance: number }[]
  /** 월별 지출(현금흐름 집계와 동일 기준) */
  expenseByMonth: Map<string, number>
  /** accountId → 월 → BANK 계좌 전체 거래 순액(입금 − 출금, 이체·분석제외 포함) — 잔액 체인 정합성 검사용 */
  bankFlows: Map<string, Map<string, number>>
}

export interface BalanceTrendRow {
  ym: string
  inProgress: boolean
  cash: number
  cashDelta: number
  liability: number | null
  netWorth: number | null
  netWorthDelta: number | null
  /** 월말 현금 ÷ 최근 3개월 평균 지출. 지출 0이면 null */
  runwayMonths: number | null
  /** 현금 증감 − BANK 거래 순액(직전 잔액을 아는 계좌만). 0이 아니면 업로드 누락·오적재 신호 */
  flowGap: number
  /** 그 달 스냅샷이 없어 이전 달 값을 이월한 사용 중 계좌 */
  carried: { accountId: string; name: string; fromYm: string }[]
  accounts: {
    id: string
    name: string
    inactive: boolean
    balance: number
    carriedFrom: string | null
  }[]
  liabilities: { id: string; name: string; balance: number }[]
}

export function buildBalanceTrend(input: BalanceTrendInput): BalanceTrendRow[] {
  const { nowYm, bankAccounts, accountSnaps } = input

  // 잔액을 아는 시점 — 스냅샷이 있거나 기초잔액이 입력된 상태. 모르는 시점의 0은 '잔액 0'이 아니다.
  const knownAt = (a: BalanceTrendInput['bankAccounts'][number], ym: string) =>
    a.openingBalance != null || lastAtOrBefore(accountSnaps.get(a.id), ym) != null
  // 어느 계좌도 잔액을 모르는 앞쪽 달은 행을 만들지 않는다(현금 0으로 보이는 오해 방지).
  const firstKnown = input.months.findIndex((ym) => bankAccounts.some((a) => knownAt(a, ym)))
  const months = firstKnown < 0 ? [] : input.months.slice(firstKnown)

  const cashAt = (ym: string) =>
    round2(
      bankAccounts.reduce(
        (acc, a) => acc + accountBalanceAt(accountSnaps.get(a.id), ym, a.openingBalance),
        0
      )
    )

  // 부채 — liabilityId별 시계열 + 최신 이름(이름 변경 반영)
  const liabSeries = new Map<string, YmBalance[]>()
  const liabName = new Map<string, string>()
  for (const s of input.liabilitySnaps) {
    const arr = liabSeries.get(s.liabilityId) ?? []
    arr.push({ ym: s.ym, balance: s.balance })
    liabSeries.set(s.liabilityId, arr)
    liabName.set(s.liabilityId, s.name)
  }
  const trackingStart = input.liabilitySnaps.reduce<string>(
    (min, s) => (s.ym < min ? s.ym : min),
    nowYm
  )
  const liabilityAt = (ym: string): number | null => {
    if (ym < trackingStart) return null
    let sum = 0
    for (const series of liabSeries.values()) sum += lastAtOrBefore(series, ym)?.balance ?? 0
    return round2(sum)
  }

  return months.map((ym) => {
    const inProgress = ym === nowYm
    const prevYm = addMonths(ym, -1)
    const cash = cashAt(ym)
    const cashDelta = round2(cash - cashAt(prevYm))
    const liability = liabilityAt(ym)
    const prevLiability = liabilityAt(prevYm)
    const netWorth = liability == null ? null : round2(cash - liability)
    const netWorthDelta =
      netWorth == null || prevLiability == null
        ? null
        : round2(netWorth - (cashAt(prevYm) - prevLiability))

    // 진행 중인 달은 지출이 덜 쌓여 버틸 개월수가 부풀므로 직전 완결 3개월을 쓴다.
    // 데이터 시작 전 달은 평균에서 빼야 지출이 묽어지지 않는다.
    const windowEnd = inProgress ? prevYm : ym
    const burnMonths = [0, -1, -2].map((d) => addMonths(windowEnd, d)).filter((m) => m >= months[0])
    const burn =
      burnMonths.reduce((acc, m) => acc + (input.expenseByMonth.get(m) ?? 0), 0) /
      (burnMonths.length || 1)
    const runwayMonths = burn > 0 ? Math.round((cash / burn) * 10) / 10 : null

    // 계좌별로 (잔액 증감 − 거래 순액). 직전 달까지 스냅샷이 없는 계좌(첫 데이터 달)는 제외 —
    // openingBalance 는 "첫 거래 직전 잔액"이 보장되지 않아(prod 에선 임의 시점 잔액) 시작 잔액이 차이로 잡힌다.
    let flowGap = 0
    for (const a of bankAccounts) {
      if (!lastAtOrBefore(accountSnaps.get(a.id), prevYm)) continue
      const snaps = accountSnaps.get(a.id)
      const delta =
        accountBalanceAt(snaps, ym, a.openingBalance) -
        accountBalanceAt(snaps, prevYm, a.openingBalance)
      flowGap += delta - (input.bankFlows.get(a.id)?.get(ym) ?? 0)
    }
    flowGap = round2(flowGap)

    const accounts: BalanceTrendRow['accounts'] = []
    const carried: BalanceTrendRow['carried'] = []
    for (const a of bankAccounts) {
      const snaps = accountSnaps.get(a.id)
      const last = lastAtOrBefore(snaps, ym)
      const balance = last?.balance ?? a.openingBalance ?? 0
      const inactive = a.status === 'INACTIVE'
      const carriedFrom = last && last.ym !== ym ? last.ym : null
      // 미사용 계좌는 잔액이 남아 있던 과거 달에만 보여 하위 행 합이 현금 합계와 맞게 한다.
      if (inactive && balance === 0) continue
      accounts.push({
        id: a.id,
        name: a.name,
        inactive,
        balance,
        carriedFrom: inactive ? null : carriedFrom,
      })
      if (!inactive && carriedFrom)
        carried.push({ accountId: a.id, name: a.name, fromYm: carriedFrom })
    }

    const liabilities: BalanceTrendRow['liabilities'] = []
    if (liability != null) {
      for (const [id, series] of liabSeries) {
        const balance = lastAtOrBefore(series, ym)?.balance ?? 0
        if (balance !== 0) liabilities.push({ id, name: liabName.get(id) ?? '', balance })
      }
    }

    return {
      ym,
      inProgress,
      cash,
      cashDelta,
      liability,
      netWorth,
      netWorthDelta,
      runwayMonths,
      flowGap,
      carried,
      accounts,
      liabilities,
    }
  })
}
