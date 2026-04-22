/**
 * 배송 주문의 원본 상품 문자열 ↔ 카탈로그 옵션 매칭 유틸.
 *
 * - 매칭은 "정규화된 원본명"을 key로 하는 정확 일치만 수행한다
 *   (퍼지 매칭은 필요 시 후속 과제).
 * - 정규화된 alias 는 ChannelProductAlias 테이블에 저장되어 다음 번
 *   같은 채널의 임포트에서 자동 매칭에 사용된다.
 */

/**
 * 원본 상품 문자열을 별칭 key로 정규화한다.
 *
 * 적용 규칙:
 *  - trim
 *  - 연속 공백 → 단일 공백
 *  - 소문자화 (ko/en 혼용 파일 대응)
 *
 * 같은 채널 내에서 동일하다고 볼 수 있는 표기는 같은 key를 갖도록 한다.
 * 카탈로그 옵션명 자체를 비교할 때도 같은 정규화를 적용하면 일관.
 */
export function normalizeAlias(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

type AliasRow = { aliasName: string; optionId: string }

/**
 * 채널별 별칭 사전을 조회해 "정규화 alias → optionId" 맵을 반환한다.
 * 호출부에서 원본 상품명을 `normalizeAlias` 로 먼저 정규화한 뒤 맵을 조회하면 된다.
 */
export function buildAliasLookup(rows: AliasRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of rows) map.set(r.aliasName, r.optionId)
  return map
}
