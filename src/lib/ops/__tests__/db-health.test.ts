import { evaluateDbHealth, parseMetrics } from '../db-health'

const TEXT = `# HELP node_vmstat_pswpin x
node_vmstat_pswpin{supabase_project_ref="r",service_type="db"} 1000
node_disk_read_bytes_total{service_type="db",device="nvme0n1"} 100
node_disk_read_bytes_total{service_type="db",device="nvme1n1"} 900
node_memory_SwapTotal_bytes{service_type="db"} 1.073741824e+09
node_memory_SwapFree_bytes{service_type="db"} 5.36870912e+08
go_memstats_sys_bytes{service_type="db"} 5
`

test('지표 텍스트에서 필요한 값만 라벨 합산해 읽는다', () => {
  expect(parseMetrics(TEXT)).toEqual({
    node_vmstat_pswpin: 1000,
    node_disk_read_bytes_total: 1000,
    node_memory_SwapTotal_bytes: 1073741824,
    node_memory_SwapFree_bytes: 536870912,
  })
})

const base = {
  node_vmstat_pswpin: 0,
  node_disk_read_bytes_total: 0,
  node_memory_SwapTotal_bytes: 1024 * 2 ** 20,
  node_memory_SwapFree_bytes: 512 * 2 ** 20,
}
// 10초 동안 swap-in 페이지(4KB)·디스크 읽기 바이트가 늘어난 두 번째 샘플
const after = (swapPages: number, readBytes: number) => ({
  ...base,
  node_vmstat_pswpin: swapPages,
  node_disk_read_bytes_total: readBytes,
})

test('평시(swap-in 4MB/s, 응답 50ms)는 문제 없음', () => {
  const r = evaluateDbHealth({ a: base, b: after(10_000, 430_000_000), dtSec: 10, pingMs: 50 })
  expect(r.problems).toEqual([])
  expect(r.swapInMBs).toBeCloseTo(3.9, 1)
  expect(r.diskReadMBs).toBeCloseTo(43, 0)
  expect(r.swapUsedMB).toBe(512)
})

test('swap-in 이 기준을 넘으면 경고', () => {
  const r = evaluateDbHealth({ a: base, b: after(60_000, 0), dtSec: 10, pingMs: 50 })
  expect(r.problems).toEqual([expect.stringMatching(/swap/)])
})

test('DB 응답이 느리거나 실패하면 경고', () => {
  expect(evaluateDbHealth({ a: base, b: base, dtSec: 10, pingMs: 5_000 }).problems).toEqual([
    expect.stringMatching(/응답/),
  ])
  expect(evaluateDbHealth({ a: base, b: base, dtSec: 10, pingMs: null }).problems).toEqual([
    expect.stringMatching(/응답/),
  ])
})

test('지표를 못 읽으면 경고(서버 자체가 응답 없음)', () => {
  expect(evaluateDbHealth({ a: null, b: null, dtSec: 10, pingMs: 50 }).problems).toEqual([
    expect.stringMatching(/지표/),
  ])
})
