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

const metrics = (swapPages: number) =>
  `node_vmstat_pswpin{service_type="db"} ${swapPages}\nnode_disk_read_bytes_total{device="nvme1n1"} 0\n`

let swapPages = 0
beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  delete process.env.OPS_SLACK_WEBHOOK_URL
  swapPages = 0
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/customer/v1/privileged/metrics')) {
      const body = metrics(swapPages)
      swapPages += 1_000_000 // 두 번째 샘플에서 swap-in 폭증
      return new Response(body)
    }
    return new Response('ok')
  })
  queryRaw.mockResolvedValue([{ ok: 1 }])
  findFirst.mockResolvedValue(null)
  notify.mockResolvedValue(true)
})

// 두 샘플 사이 대기(10초)는 가짜 타이머로 건너뛴다
async function run() {
  jest.useFakeTimers()
  try {
    // withCronRun 은 목에서 핸들러를 그대로 돌려주므로 반환값이 detail 객체다
    const p = GET(new NextRequest('http://localhost/api/cron/db-health')) as unknown as Promise<
      Record<string, unknown>
    >
    await jest.advanceTimersByTimeAsync(30_000)
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

test('정상이면 알림 없음', async () => {
  fetchMock.mockImplementation(async () => new Response(metrics(0)))
  const detail = await run()
  expect(notify).not.toHaveBeenCalled()
  expect(detail.notified).toBe(false)
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
