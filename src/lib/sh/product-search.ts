// InvProduct 검색 where 조각 생성 — 목록/피커 검색 엔드포인트 공용 헬퍼.
// 화면 표시명(productDisplayName)이 internalName ?? name 이므로, 공식명(name)도
// 항상 검색 대상에 포함해야 관리명 없는 상품이 화면에 보이는 이름으로 검색된다.

import type { Prisma } from '@/generated/prisma/client'
import { tokenizeProductName } from '@/lib/inv/search-tokens'

/**
 * 기본 토큰 분리 — 공백(\s+)만 구분자로 사용, 최대 12개, 대소문자 무시 dedupe.
 * `tokenizeProductName` 의 SEPARATOR 는 `-` `/` 까지 쪼개서 'BLK-S' 같은 정확 검색어를
 * 과분리하므로, 사용자 직접 입력 검색에는 쓰지 않는다(opts.aggressive 시에만 사용).
 */
function tokenizeBasic(raw: string, maxTokens = 12): string[] {
  const tokens: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(/\s+/)) {
    const token = part.trim()
    if (!token) continue
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tokens.push(token)
    if (tokens.length >= maxTokens) break
  }
  return tokens
}

function fieldOr(term: string): NonNullable<Prisma.InvProductWhereInput['OR']> {
  return [
    { name: { contains: term, mode: 'insensitive' } },
    { internalName: { contains: term, mode: 'insensitive' } },
    { nameEn: { contains: term, mode: 'insensitive' } },
    { code: { contains: term, mode: 'insensitive' } },
    { brand: { name: { contains: term, mode: 'insensitive' } } },
    { options: { some: { deletedAt: null, name: { contains: term, mode: 'insensitive' } } } },
    { options: { some: { deletedAt: null, sku: { contains: term, mode: 'insensitive' } } } },
  ]
}

/**
 * 검색어를 InvProduct where 조각으로 변환한다.
 * - 토큰 2개 이상: AND(각 토큰이 OR 필드 중 하나라도 매칭)
 * - 토큰 1개: OR 필드 매칭
 * - 빈 검색어(공백만 포함): null → 호출부에서 where 미적용
 *
 * @param opts.aggressive true면 `tokenizeProductName`(하이픈·슬래시 등도 분리)을 사용한다.
 *   재고조정 파일 상품명 매칭 picker처럼 검증된 토큰화 규칙을 그대로 써야 하는 경로 전용.
 */
export function productSearchFilter(
  search: string,
  opts?: { aggressive?: boolean }
): Prisma.InvProductWhereInput | null {
  const trimmed = search.trim()
  if (!trimmed) return null

  const tokens = opts?.aggressive ? tokenizeProductName(trimmed) : tokenizeBasic(trimmed)
  if (tokens.length === 0) return null

  if (tokens.length >= 2) {
    return { AND: tokens.map((t) => ({ OR: fieldOr(t) })) }
  }
  return { OR: fieldOr(tokens[0]) }
}
