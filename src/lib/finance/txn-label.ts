/**
 * 화면용 적요 — `description` 에 이미 포함되지 않은 `counterparty` 만 ` / ` 로 병기한다.
 *
 * 검색(`queries.ts` 의 q OR 절)은 description·counterparty 둘 다 훑고,
 * 규칙 매칭(`classify.ts` 의 buildMatchText)도 둘을 합쳐 쓴다.
 * 표시만 `description ?? counterparty` 폴백이었던 탓에, counterparty 로 검색된 행이
 * "없는 키워드로 검색됨" 처럼 보였다. 구분자는 기존 다중 컬럼 매핑 관례(parser.ts)와 동일하게 ` / `.
 */
export function finTxnLabel(r: {
  description?: string | null
  counterparty?: string | null
}): string {
  const d = (r.description ?? '').trim()
  const c = (r.counterparty ?? '').trim()
  if (!d) return c || '-'
  if (!c || d.includes(c)) return d
  return `${d} / ${c}`
}
