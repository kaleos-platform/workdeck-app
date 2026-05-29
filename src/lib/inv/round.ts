// 발주 수량 라운딩 — unit 단위로 올림 (unit<=1이면 정수 올림)
export function roundUp(qty: number, unit: number): number {
  if (unit <= 1) return Math.ceil(qty)
  return Math.ceil(qty / unit) * unit
}
