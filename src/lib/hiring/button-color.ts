// 버튼 블록 색상 유틸 — 서버/클라이언트 겸용.
// 프리셋 팔레트 + 배경 밝기(YIQ)에 따른 글자색 자동 결정.

export const BUTTON_DEFAULT_COLOR = '#18181b' // zinc-900 (기존 bg-primary 근사)

export const BUTTON_PRESET_COLORS = [
  BUTTON_DEFAULT_COLOR,
  '#2563eb', // blue-600
  '#059669', // emerald-600
  '#dc2626', // red-600
  '#ea580c', // orange-600
  '#7c3aed', // violet-600
  '#0891b2', // cyan-600
  '#db2777', // pink-600
] as const

// #rrggbb → 밝으면 검정, 어두우면 흰색 (YIQ 대비)
export function buttonTextColor(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 150 ? '#18181b' : '#ffffff'
}

// 버튼 블록 인라인 스타일 (color 미지정 시 기본색)
export function buttonBlockStyle(color?: string | null): {
  backgroundColor: string
  color: string
} {
  const bg = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : BUTTON_DEFAULT_COLOR
  return { backgroundColor: bg, color: buttonTextColor(bg) }
}
