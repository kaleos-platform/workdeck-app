/** 업무 랜딩·안내 메일의 「바로 시작하기」 — 가입 후 곧장 그 업무의 구독 확인을 연다 */
export function deckStartPath(slug: string): string {
  return `/signup?redirectTo=${encodeURIComponent(`/my-deck?subscribe=${slug}`)}`
}
