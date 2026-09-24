/**
 * 재고 현황 등급 설정 — `InvSettings.preferences`(Json) 안에 사는 화면 전용 값들.
 * 서버(queryStockStatus)가 읽어 응답에 실어 보내고, 클라이언트 view-model 이 등급 계산에 쓴다.
 * 발주 계획·MCP 의 계산에는 반영되지 않는다(문구로도 명시한다).
 */

/** 일평균 출고를 구할 때 우선 볼 기간. 해당 기간 출고가 0이면 더 긴 기간으로 폴백한다. */
export type StockAvgWindow = 'auto' | 30 | 90

export type StockGradeSettings = {
  /** 위험 임계 = 리드타임 × 이 배수 */
  riskMultiplier: number
  /** 발주시기 임계 = 리드타임 × 이 배수 */
  reorderMultiplier: number
  /** 상품별 InvReorderConfig 가 아예 없는 상품에 적용할 리드타임 */
  defaultLeadTimeDays: number
  avgWindow: StockAvgWindow
  /** 커버 일수를 (재고 − 안전재고) 기준으로 계산할지 */
  applySafetyStock: boolean
}

export const DEFAULT_STOCK_GRADE_SETTINGS: StockGradeSettings = {
  riskMultiplier: 1,
  reorderMultiplier: 2,
  defaultLeadTimeDays: 7,
  avgWindow: 'auto',
  applySafetyStock: false,
}

const PREFERENCE_KEYS = {
  risk: 'gradeRiskMultiplier',
  reorder: 'gradeReorderMultiplier',
  leadTime: 'defaultLeadTimeDays',
  avgWindow: 'gradeAvgWindow',
  safety: 'gradeApplySafetyStock',
} as const

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseAvgWindow(value: unknown): StockAvgWindow | null {
  if (value === 'auto') return 'auto'
  if (value === 30 || value === 90) return value
  return null
}

/** preferences JSON → 설정. 값이 없거나 형식이 틀리면 기본값으로 떨어진다(화면이 멈추면 안 된다). */
export function readStockGradeSettings(preferences: unknown): StockGradeSettings {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return DEFAULT_STOCK_GRADE_SETTINGS
  }
  const raw = preferences as Record<string, unknown>
  const risk = finiteNumber(raw[PREFERENCE_KEYS.risk])
  const reorder = finiteNumber(raw[PREFERENCE_KEYS.reorder])
  const leadTime = finiteNumber(raw[PREFERENCE_KEYS.leadTime])
  const avgWindow = parseAvgWindow(raw[PREFERENCE_KEYS.avgWindow])
  const safety = raw[PREFERENCE_KEYS.safety]

  return {
    riskMultiplier: risk !== null && risk > 0 ? risk : DEFAULT_STOCK_GRADE_SETTINGS.riskMultiplier,
    reorderMultiplier:
      reorder !== null && reorder > 0 ? reorder : DEFAULT_STOCK_GRADE_SETTINGS.reorderMultiplier,
    defaultLeadTimeDays:
      leadTime !== null && leadTime >= 0
        ? Math.floor(leadTime)
        : DEFAULT_STOCK_GRADE_SETTINGS.defaultLeadTimeDays,
    avgWindow: avgWindow ?? DEFAULT_STOCK_GRADE_SETTINGS.avgWindow,
    applySafetyStock:
      typeof safety === 'boolean' ? safety : DEFAULT_STOCK_GRADE_SETTINGS.applySafetyStock,
  }
}

/**
 * 설정 → preferences 에 병합할 부분 객체. 등급 계산에 직접 들어가는 값이라 여기서 검증한다.
 * 잘못된 값이면 에러 메시지를 반환한다(호출 측이 400 으로 바꾼다).
 */
export function validateStockGradeSettings(
  input: unknown
): { ok: true; patch: Record<string, unknown> } | { ok: false; message: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '등급 설정 형식이 올바르지 않습니다' }
  }
  const raw = input as Record<string, unknown>
  const patch: Record<string, unknown> = {}

  const risk = finiteNumber(raw.riskMultiplier)
  const reorder = finiteNumber(raw.reorderMultiplier)
  if (risk === null || reorder === null) {
    return { ok: false, message: '배수는 숫자여야 합니다' }
  }
  if (risk <= 0 || reorder <= 0 || risk > 100 || reorder > 100) {
    return { ok: false, message: '배수는 0보다 크고 100 이하여야 합니다' }
  }
  if (reorder < risk) {
    return { ok: false, message: '발주시기 배수는 위험 배수보다 작을 수 없습니다' }
  }
  patch[PREFERENCE_KEYS.risk] = risk
  patch[PREFERENCE_KEYS.reorder] = reorder

  const leadTime = finiteNumber(raw.defaultLeadTimeDays)
  if (leadTime === null || leadTime < 0 || leadTime > 365 || !Number.isInteger(leadTime)) {
    return { ok: false, message: '기본 리드타임은 0~365 사이 정수여야 합니다' }
  }
  patch[PREFERENCE_KEYS.leadTime] = leadTime

  const avgWindow = parseAvgWindow(raw.avgWindow)
  if (avgWindow === null) {
    return { ok: false, message: "일평균 기준은 'auto', 30, 90 중 하나여야 합니다" }
  }
  patch[PREFERENCE_KEYS.avgWindow] = avgWindow

  if (typeof raw.applySafetyStock !== 'boolean') {
    return { ok: false, message: '안전재고 반영 여부는 true/false 여야 합니다' }
  }
  patch[PREFERENCE_KEYS.safety] = raw.applySafetyStock

  return { ok: true, patch }
}
