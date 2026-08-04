/**
 * coupang-ads 캠페인 상세 — 커스텀 지표 필터 공유 단일 소스.
 *
 * 키워드 탭(서버 SQL)과 상품 탭(클라 JS)이 동일한 조건 스키마를 공유한다.
 * 두 evaluator의 의미가 반드시 일치해야 한다:
 *  - null 지표(ROAS/CTR/CVR의 분모 0)는 모든 비교에 실패(= 행 제외).
 *    SQL은 `NULL < x`가 unknown→제외지만, JS는 `null < x`가 null→0 강제변환되어
 *    포함으로 갈라지므로 evalConditions에서 명시 가드한다.
 *  - ROAS/CTR/CVR은 표시 단위(백분율, ×100)로 비교한다.
 */

export type MetricKey =
  | 'roas'
  | 'adCost'
  | 'adCostShare'
  | 'orders1d'
  | 'revenue1d'
  | 'ctr'
  | 'cvr'
  | 'impressions'
  | 'clicks'

export type FilterOp = 'lt' | 'lte' | 'gte' | 'gt'

export type MetricCondition = { metric: MetricKey; op: FilterOp; value: number }

export type PresetId = 'zero' | 'orders'

// ─── UI 라벨/단위 ─────────────────────────────────────────────────────────────

export const METRIC_KEYS: MetricKey[] = [
  'roas',
  'adCost',
  'adCostShare',
  'orders1d',
  'revenue1d',
  'ctr',
  'cvr',
  'impressions',
  'clicks',
]

export const METRIC_LABELS: Record<MetricKey, string> = {
  roas: 'ROAS',
  adCost: '광고비',
  adCostShare: '광고비 비중',
  orders1d: '주문 수',
  revenue1d: '매출액',
  ctr: 'CTR',
  cvr: 'CVR',
  impressions: '노출 수',
  clicks: '클릭 수',
}

export const METRIC_UNIT: Record<MetricKey, string> = {
  roas: '%',
  adCost: '원',
  adCostShare: '%',
  orders1d: '개',
  revenue1d: '원',
  ctr: '%',
  cvr: '%',
  impressions: '회',
  clicks: '회',
}

export const OP_KEYS: FilterOp[] = ['lt', 'lte', 'gte', 'gt']

export const OP_LABELS: Record<FilterOp, string> = {
  lt: '미만',
  lte: '이하',
  gte: '이상',
  gt: '초과',
}

const OP_SYMBOL: Record<FilterOp, string> = {
  lt: '<',
  lte: '≤',
  gte: '≥',
  gt: '>',
}

/** 활성 조건 요약 텍스트 — 예: "ROAS<100 · 광고비≥5000". 빈 배열 → ''. */
export function describeConditions(conds: MetricCondition[]): string {
  return conds
    .map((c) => `${METRIC_LABELS[c.metric]}${OP_SYMBOL[c.op]}${c.value}${METRIC_UNIT[c.metric]}`)
    .join(' · ')
}

// ─── 프리셋(커스텀 기본값) ────────────────────────────────────────────────────

/**
 * 기존 프리셋을 커스텀 조건으로 표현 — 클릭 시 빌더에 프리필된다.
 *  - zero(저효율): 광고비 > 0 AND 주문 <= 0 (돈 썼는데 주문 0)
 *  - orders(주문 발생): 주문 >= 1
 */
export const PRESETS: Record<PresetId, MetricCondition[]> = {
  zero: [
    { metric: 'adCost', op: 'gt', value: 0 },
    { metric: 'orders1d', op: 'lte', value: 0 },
  ],
  orders: [{ metric: 'orders1d', op: 'gte', value: 1 }],
}

// ─── 검증/직렬화 (URL 파라미터·localStorage 공용) ─────────────────────────────

const METRIC_SET = new Set<string>(METRIC_KEYS)
const OP_SET = new Set<string>(OP_KEYS)
const MAX_CONDITIONS = 10

function isCondition(v: unknown): v is MetricCondition {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    typeof c.metric === 'string' &&
    METRIC_SET.has(c.metric) &&
    typeof c.op === 'string' &&
    OP_SET.has(c.op) &&
    typeof c.value === 'number' &&
    Number.isFinite(c.value)
  )
}

/** 조건 배열을 검증해 정상 항목만 반환. 실패/형식오류 시 []. */
export function parseConditions(raw: string | null | undefined): MetricCondition[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isCondition).slice(0, MAX_CONDITIONS)
  } catch {
    return []
  }
}

export function serializeConditions(conds: MetricCondition[]): string {
  return JSON.stringify(conds)
}

/** 두 조건 배열이 (순서 포함) 동일한지 — 프리셋 버튼 활성 표시용. */
export function conditionsEqual(a: MetricCondition[], b: MetricCondition[]): boolean {
  if (a.length !== b.length) return false
  return a.every((c, i) => c.metric === b[i].metric && c.op === b[i].op && c.value === b[i].value)
}

// ─── 클라이언트 evaluator (상품 탭) ───────────────────────────────────────────

function compare(v: number, op: FilterOp, value: number): boolean {
  switch (op) {
    case 'lt':
      return v < value
    case 'lte':
      return v <= value
    case 'gte':
      return v >= value
    case 'gt':
      return v > value
  }
}

/**
 * 행이 모든 조건(AND)을 만족하는지. 빈 배열 → true.
 * null/비유한 지표는 해당 조건 실패(= 제외) — SQL NULL 의미와 일치.
 */
export function evalConditions(
  row: Partial<Record<MetricKey, number | null>>,
  conds: MetricCondition[]
): boolean {
  return conds.every((c) => {
    const v = row[c.metric]
    if (v == null || !Number.isFinite(v)) return false
    return compare(v, c.op, c.value)
  })
}

// ─── 서버 SQL HAVING 빌더 (키워드 탭) ─────────────────────────────────────────

const OP_SQL: Record<FilterOp, string> = {
  lt: '<',
  lte: '<=',
  gte: '>=',
  gt: '>',
}

/**
 * 키워드 집계 CTE 별칭 기준 컬럼식. 표시값과 동일 스케일/의미.
 *  - adCostShare 분모(total_ad_cost)는 캠페인 총 광고비 컬럼(호출부 CTE가 제공).
 */
const METRIC_SQL: Record<MetricKey, string> = {
  adCost: '"adCost"',
  orders1d: '"orders1d"',
  revenue1d: '"revenue1d"',
  impressions: 'impressions',
  clicks: 'clicks',
  roas: 'CASE WHEN "adCost" > 0 THEN "revenue1d" / "adCost" * 100 ELSE NULL END',
  ctr: 'CASE WHEN impressions > 0 THEN clicks::numeric / impressions * 100 ELSE NULL END',
  cvr: 'CASE WHEN clicks > 0 THEN "orders1d"::numeric / clicks * 100 ELSE NULL END',
  adCostShare: '"adCost" / NULLIF(total_ad_cost, 0) * 100',
}

/**
 * 광고 데이터(records) 행별 컬럼식 — AdRecord 원본 컬럼 기준(집계 아님).
 * 행별 광고비 비중(adCostShare)은 계산 불가라 제외한다.
 */
const RECORD_METRIC_SQL: Partial<Record<MetricKey, string>> = {
  adCost: '"adCost"',
  orders1d: '"orders1d"',
  revenue1d: '"revenue1d"',
  impressions: '"impressions"',
  clicks: '"clicks"',
  roas: 'CASE WHEN "adCost" > 0 THEN "revenue1d" / "adCost" * 100 ELSE NULL END',
  ctr: 'CASE WHEN "impressions" > 0 THEN "clicks"::numeric / "impressions" * 100 ELSE NULL END',
  cvr: 'CASE WHEN "clicks" > 0 THEN "orders1d"::numeric / "clicks" * 100 ELSE NULL END',
}

/** 광고 데이터 탭에서 필터 가능한 메트릭(비중 제외). 빌더 allowedMetrics용. */
export const RECORD_METRIC_KEYS: MetricKey[] = METRIC_KEYS.filter((k) => k !== 'adCostShare')

/**
 * 커스텀 조건 → SQL 절(WHERE 또는 집계 후 HAVING) + 파라미터. 컬럼식은 exprMap
 * lookup(요청 문자열 보간 금지), 연산자는 enum lookup, 값만 $N 바인딩.
 * exprMap에 없는 메트릭(예: records의 adCostShare)은 조건에서 스킵한다.
 *
 * @param startParamIndex 첫 $N 인덱스(호출부의 다음 파라미터 번호).
 * @returns clause: `(expr) op $N AND ...` (빈 조건 시 ''), values: 바인딩 순서대로.
 */
export function buildMetricSql(
  conds: MetricCondition[],
  exprMap: Partial<Record<MetricKey, string>>,
  startParamIndex: number
): { clause: string; values: number[] } {
  const parts: string[] = []
  const values: number[] = []
  let idx = startParamIndex

  for (const c of conds) {
    const expr = exprMap[c.metric]
    if (!expr || !OP_SET.has(c.op) || !Number.isFinite(c.value)) continue
    parts.push(`(${expr}) ${OP_SQL[c.op]} $${idx}`)
    values.push(c.value)
    idx += 1
  }

  return { clause: parts.join(' AND '), values }
}

/** 키워드 집계 HAVING 빌더 — buildMetricSql 래퍼(기존 시그니처 유지). */
export function buildKeywordHavingSql(
  conds: MetricCondition[],
  startParamIndex: number
): { clause: string; values: number[] } {
  return buildMetricSql(conds, METRIC_SQL, startParamIndex)
}

/** 광고 데이터(records) 행별 WHERE 빌더 — buildMetricSql 래퍼. */
export function buildRecordWhereSql(
  conds: MetricCondition[],
  startParamIndex: number
): { clause: string; values: number[] } {
  return buildMetricSql(conds, RECORD_METRIC_SQL, startParamIndex)
}
