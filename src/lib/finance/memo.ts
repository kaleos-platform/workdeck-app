/** 거래 메모 입력 정규화 — API PATCH 공용. */
export const MEMO_MAX = 500

export type MemoInputResult =
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string }

/**
 * body.memo 정규화: undefined=변경 없음, null/빈 문자열=삭제(null), 그 외 trim 문자열.
 * 문자열 외 타입·MEMO_MAX 초과는 에러.
 */
export function normalizeMemoInput(v: unknown): MemoInputResult {
  if (v === undefined) return { ok: true, value: undefined }
  if (v === null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: '메모는 문자열이어야 합니다' }
  const t = v.trim()
  if (t.length > MEMO_MAX) return { ok: false, error: `메모는 ${MEMO_MAX}자 이내로 입력하세요` }
  return { ok: true, value: t === '' ? null : t }
}
