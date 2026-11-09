// 운영 DB 서버(Supabase) 건강 판정 — 2026-11-09 장애는 메모리 부족 swap 이 디스크 IO 를 잠식해
// DB 전체가 멈춘 것이었다(평시 swap-in ~4MB/s, 디스크 읽기 ~43MB/s). 그때 알림이 하나도 없었다.

const WATCHED = [
  'node_cpu_seconds_total', // 항상 증가 — 지표가 갱신됐는지 판별용
  'node_vmstat_pswpin',
  'node_disk_read_bytes_total',
  'node_memory_SwapTotal_bytes',
  'node_memory_SwapFree_bytes',
] as const

export type MetricValues = Record<(typeof WATCHED)[number], number>

/** 기준 — 평시 실측의 약 5배(swap-in), 장애 때 단일 행 쿼리가 20초 이상 걸렸다(응답). */
export const SWAP_IN_ALERT_MBS = 20
export const PING_ALERT_MS = 3_000

const MB = 1024 * 1024
const PAGE_BYTES = 4096

/** Prometheus 텍스트에서 감시 지표만 라벨(디스크 장치 등)을 합산해 읽는다. */
export function parseMetrics(text: string): MetricValues {
  const out = Object.fromEntries(WATCHED.map((k) => [k, 0])) as MetricValues
  for (const line of text.split('\n')) {
    const m = /^([a-zA-Z_]+)(?:\{[^}]*\})?\s+(\S+)$/.exec(line)
    if (m && m[1] in out) out[m[1] as keyof MetricValues] += Number(m[2])
  }
  return out
}

export function evaluateDbHealth(input: {
  a: MetricValues | null
  b: MetricValues | null
  dtSec: number
  pingMs: number | null
}) {
  const { a, b, dtSec, pingMs } = input
  const problems: string[] = []
  let swapInMBs: number | undefined
  let diskReadMBs: number | undefined
  let swapUsedMB: number | undefined

  if (!a || !b) {
    problems.push('DB 서버 지표를 읽지 못했거나 갱신이 멈췄습니다')
  } else {
    // 서버 재시작이면 누적 카운터가 0부터 다시 쌓인다 — 음수 차이는 속도로 쓰지 않는다.
    const swapDelta = b.node_vmstat_pswpin - a.node_vmstat_pswpin
    const readDelta = b.node_disk_read_bytes_total - a.node_disk_read_bytes_total
    if (swapDelta >= 0) swapInMBs = (swapDelta * PAGE_BYTES) / MB / dtSec
    if (readDelta >= 0) diskReadMBs = readDelta / 1e6 / dtSec
    swapUsedMB = Math.round((b.node_memory_SwapTotal_bytes - b.node_memory_SwapFree_bytes) / MB)
    if (swapInMBs !== undefined && swapInMBs > SWAP_IN_ALERT_MBS) {
      problems.push(`swap-in ${swapInMBs.toFixed(1)}MB/s (기준 ${SWAP_IN_ALERT_MBS}MB/s)`)
    }
  }

  if (pingMs === null) problems.push('DB 응답 없음(SELECT 1 실패·시간 초과)')
  else if (pingMs > PING_ALERT_MS) problems.push(`DB 응답 ${pingMs}ms (기준 ${PING_ALERT_MS}ms)`)

  return { problems, swapInMBs, diskReadMBs, swapUsedMB, pingMs }
}
