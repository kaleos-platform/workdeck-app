/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import { sendSystemNotification } from '@/lib/slack/send-notification'

jest.mock('@/lib/cron/with-cron-run', () => ({
  withCronRun: (_path: string, handler: (r: unknown) => Promise<Record<string, unknown>>) =>
    handler,
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { $queryRaw: jest.fn(), cronRun: { findFirst: jest.fn() } },
}))
jest.mock('@/lib/slack/send-notification', () => ({ sendSystemNotification: jest.fn() }))

const queryRaw = prisma.$queryRaw as unknown as jest.Mock
const findFirst = prisma.cronRun.findFirst as unknown as jest.Mock
const notify = sendSystemNotification as unknown as jest.Mock
const fetchMock = jest.fn()

// Supabase 지표는 약 60초마다 갱신된다 — 가짜 시계의 분 단위로 값이 바뀌게 흉내 낸다.
let swapPagesPerMin = 0
let frozen = false
function metricsNow() {
  const minute = frozen ? 0 : Math.floor(Date.now() / 60_000)
  return [
    `node_cpu_seconds_total{cpu="0",mode="idle"} ${minute * 60}`,
    `node_vmstat_pswpin{service_type="db"} ${minute * swapPagesPerMin}`,
    `node_disk_read_bytes_total{device="nvme1n1"} 0`,
  ].join('\n')
}

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  delete process.env.OPS_SLACK_WEBHOOK_URL
  swapPagesPerMin = 1_000_000 // 약 65MB/s — 기준(20MB/s) 초과
  frozen = false
  fetchMock.mockImplementation(async (url: string) =>
    url.includes('/customer/v1/privileged/metrics')
      ? new Response(metricsNow())
      : new Response('ok')
  )
  queryRaw.mockResolvedValue([{ ok: 1 }])
  findFirst.mockResolvedValue(null)
  notify.mockResolvedValue(true)
})

// 지표 갱신 대기(최대 몇 분)는 가짜 타이머로 건너뛴다
async function run() {
  jest.useFakeTimers()
  try {
    // withCronRun 은 목에서 핸들러를 그대로 돌려주므로 반환값이 detail 객체다
    const p = GET(new NextRequest('http://localhost/api/cron/db-health')) as unknown as Promise<
      Record<string, unknown>
    >
    await jest.advanceTimersByTimeAsync(300_000)
    return await p
  } finally {
    jest.useRealTimers()
  }
}

test('기준 초과면 시스템 알림을 보내고 notified 를 남긴다', async () => {
  const detail = await run()
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ text: expect.stringMatching(/DB/) })
  )
  expect(detail.notified).toBe(true)
  const metricsCall = fetchMock.mock.calls.find(([u]) => String(u).includes('metrics'))!
  expect(metricsCall[0]).toBe('https://ref.supabase.co/customer/v1/privileged/metrics')
})

test('정상(swap-in 약 4MB/s)이면 알림 없음 — 속도는 연속 두 갱신 사이로 잰다', async () => {
  swapPagesPerMin = 60_000
  const detail = await run()
  expect(notify).not.toHaveBeenCalled()
  expect(detail.notified).toBe(false)
  expect(detail.swapInMBs as number).toBeCloseTo(3.9, 1)
})

test('지표가 갱신되지 않으면(서버 정지) 경고', async () => {
  frozen = true
  const detail = await run()
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ text: expect.stringMatching(/지표/) })
  )
  expect(detail.notified).toBe(true)
})

test('최근 60분 안에 이미 알렸으면 다시 보내지 않는다', async () => {
  findFirst.mockResolvedValue({ id: 'r1' })
  const detail = await run()
  expect(notify).not.toHaveBeenCalled()
  expect(detail.deduped).toBe(true)
})

test('DB 가 죽어 시스템 알림이 실패하면 webhook 으로 보낸다', async () => {
  process.env.OPS_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x'
  queryRaw.mockRejectedValue(new Error('ECHECKOUTTIMEOUT'))
  findFirst.mockRejectedValue(new Error('ECHECKOUTTIMEOUT'))
  notify.mockResolvedValue(false)
  const detail = await run()
  const hook = fetchMock.mock.calls.find(([u]) => u === 'https://hooks.slack.test/x')
  expect(hook).toBeTruthy()
  expect(JSON.parse(hook![1].body).text).toMatch(/DB 응답 없음/)
  expect(detail.notified).toBe(true)
})
