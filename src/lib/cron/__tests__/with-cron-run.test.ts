/** @jest-environment node */
import { NextRequest } from 'next/server'
import { withCronRun } from '../with-cron-run'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({ prisma: { cronRun: { create: jest.fn() } } }))

const request = () =>
  new NextRequest('http://localhost/api/cron/example', {
    headers: { authorization: 'Bearer test-secret' },
  })
beforeEach(() => {
  jest.resetAllMocks()
  process.env.CRON_SECRET = 'test-secret'
})
afterEach(() => {
  delete process.env.CRON_SECRET
})

it('다른 cron은 failed 집계가 있어도 기존대로 성공 이력을 남긴다', async () => {
  const response = await withCronRun('/api/cron/example', async () => ({ failed: 1 }))(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ failed: 1 })
  expect(prisma.cronRun.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ ok: true, detail: { failed: 1 } }),
  })
})

it('handler 예외는 실패 이력과 HTTP 500을 반환한다', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const response = await withCronRun('/api/cron/example', async () => {
      throw new Error('example failure')
    })(request())
    expect(response.status).toBe(500)
    expect(prisma.cronRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ok: false, error: 'example failure' }),
    })
  } finally {
    log.mockRestore()
  }
})

it('이력 저장 실패가 정상 응답을 방해하지 않는다', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  try {
    ;(prisma.cronRun.create as jest.Mock).mockRejectedValue(new Error('db unavailable'))
    const response = await withCronRun('/api/cron/example', async () => ({ done: 1 }))(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ done: 1 })
  } finally {
    log.mockRestore()
  }
})
