/** @jest-environment node */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readPlatformGoogle } from '@/lib/admin/platform-google'
import { loadGa4Bundle } from '@/lib/admin/platform-ga4'
import { sendSystemNotification } from '@/lib/slack/send-notification'
import { GET } from '../route'

jest.mock('server-only', () => ({}))
jest.mock('@/lib/prisma', () => ({ prisma: { cronRun: { create: jest.fn() } } }))
jest.mock('@/lib/admin/platform-google', () => ({ readPlatformGoogle: jest.fn() }))
jest.mock('@/lib/admin/platform-ga4', () => ({
  ...jest.requireActual('@/lib/admin/platform-ga4'),
  loadGa4Bundle: jest.fn(),
}))
jest.mock('@/lib/slack/send-notification', () => ({ sendSystemNotification: jest.fn() }))

const create = prisma.cronRun.create as unknown as jest.Mock
const notify = sendSystemNotification as unknown as jest.Mock
const call = (auth?: string) =>
  GET(
    new NextRequest('http://localhost/api/cron/platform-funnel-report', {
      headers: auth ? { authorization: auth } : {},
    })
  )

const bundle = (enhancedOn: boolean) => ({
  measurementId: 'G-5F8G9Y4VHW',
  enhanced: { streamEnabled: enhancedOn, scrollsEnabled: false },
  funnel: {
    days: 7,
    events: {
      page_view: 100,
      cta_click: 10,
      generate_lead: 1,
      sign_up: 3,
      trial_start: 2,
      subscribe: 1,
    },
    sources: [{ source: 'google', medium: 'cpc', signUp: 3, subscribe: 1 }],
  },
  errors: [],
})

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'cron'
  notify.mockResolvedValue(true)
  ;(readPlatformGoogle as jest.Mock).mockResolvedValue({ config: { status: 'connected' } })
  ;(loadGa4Bundle as jest.Mock).mockResolvedValue(bundle(false))
})

test('인증 없으면 401, 발송·조회 없음', async () => {
  expect((await call()).status).toBe(401)
  expect((await call('Bearer wrong')).status).toBe(401)
  expect(notify).not.toHaveBeenCalled()
})

test('미연결이면 한 줄 경고를 보낸다', async () => {
  ;(readPlatformGoogle as jest.Mock).mockResolvedValue(null)
  const res = await call('Bearer cron')
  expect(res.status).toBe(200)
  expect(notify.mock.calls[0][0].text).toMatch(/연결되어 있지 않아/)
  expect(loadGa4Bundle).not.toHaveBeenCalled()
  expect(create.mock.calls[0][0].data.ok).toBe(true)
})

test('연결됨이면 요약 발송, 향상된 측정이 켜져 있으면 경고 줄 포함', async () => {
  ;(loadGa4Bundle as jest.Mock).mockResolvedValue(bundle(true))
  const res = await call('Bearer cron')
  expect(await res.json()).toMatchObject({ state: 'connected', sent: true })
  const text = notify.mock.calls[0][0].text as string
  expect(text).toContain('page_view 100')
  expect(text).toContain('향상된 측정이 켜져 있습니다')
  expect(text).toContain('streamEnabled')
  expect(create.mock.calls[0][0].data.ok).toBe(true)
})

test('향상된 측정이 모두 꺼져 있으면 경고 줄 없음', async () => {
  await call('Bearer cron')
  expect(notify.mock.calls[0][0].text).not.toContain('향상된 측정이 켜져')
})

test('발송 false(채널 없음·전부 실패)면 withCronRun 이 실패로 기록한다', async () => {
  notify.mockResolvedValue(false)
  const res = await call('Bearer cron')
  expect(res.status).toBe(200)
  expect(create.mock.calls[0][0].data).toMatchObject({
    path: '/api/cron/platform-funnel-report',
    ok: false,
  })
})
