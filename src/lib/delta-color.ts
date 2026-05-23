// 증감 색상 — 단순 부호 기반
// 증가(↑) = red, 감소(↓) = green, 변동없음/null = muted
export function getDeltaColor(diff: number | null): string {
  if (diff === null || diff === 0) return 'text-muted-foreground'
  return diff > 0 ? 'text-red-500' : 'text-green-600'
}
