'use client'

/**
 * Sparkline — 테이블 행 안에 표시되는 초경량 인라인 차트.
 * recharts 대신 순수 SVG 폴리라인 사용:
 *   - ResponsiveContainer/ResizeObserver 오버헤드 없음 (200행 × 동시 렌더 고려)
 *   - stroke="currentColor" 로 다크 모드 자동 대응
 *   - jsdom 에서도 정상 렌더 (recharts 는 ResizeObserver=0 문제 있음)
 */

interface SparklineProps {
  data: Array<{ date: string; views: number }>
  /** SVG 너비 px (기본 80) */
  width?: number
  /** SVG 높이 px (기본 24) */
  height?: number
}

export function Sparkline({ data, width = 80, height = 24 }: SparklineProps) {
  // 데이터 없거나 전부 0 이면 플레이스홀더
  const hasData = data.length > 0 && data.some((d) => d.views > 0)
  if (!hasData) {
    return <span className="text-xs text-muted-foreground select-none">—</span>
  }

  const values = data.map((d) => d.views)
  const maxVal = Math.max(...values)
  const minVal = Math.min(...values)
  const range = maxVal - minVal || 1 // 0 나눔 방지

  const pad = 1.5 // 상하 여백 (px)
  const innerH = height - pad * 2
  const step = (width - 2) / (values.length - 1)

  // (x, y) 좌표 계산 — SVG 좌표계: y=0 이 위쪽
  const points = values
    .map((v, i) => {
      const x = 1 + i * step
      const y = pad + innerH - ((v - minVal) / range) * innerH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="shrink-0 overflow-visible text-primary/70"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
