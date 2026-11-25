import type { Suggestion } from '@/types/analysis'

/** AI 제안에서 키워드 제거 제안을 뺀다(제외 키워드 화면의 코드 규칙과 충돌 방지). */
export function excludeRemoveKeyword(suggestions: Suggestion[] | null | undefined): Suggestion[] {
  return (suggestions ?? []).filter((s) => s.type !== 'REMOVE_KEYWORD')
}
