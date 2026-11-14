/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { removeApplicantFiles } from '@/lib/hiring/storage'

jest.mock('@/lib/cron/with-cron-run', () => ({ withCronRun: (_: string, fn: unknown) => fn }))
jest.mock('@/lib/hiring/storage', () => ({ removeApplicantFiles: jest.fn() }))
jest.mock('@/lib/prisma', () => {
  const { Client } = jest.requireActual<typeof import('pg')>('pg')
  const client = new Client()
  const ready = client.connect()
  const prisma = {
    hiringUploadSession: {
      findMany: jest.fn().mockResolvedValue([{ id: 'expired' }]),
      count: jest.fn().mockResolvedValue(1),
      updateMany: jest.fn(async () => {
        await ready
        const result = await client.query('UPDATE sessions SET "claimedAt"=now() WHERE id=$1', ['expired'])
        return { count: result.rowCount }
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(prisma)),
    close: async () => { await ready; await client.end() },
  }
  return { prisma }
})
const localTest = process.env.WORKDECK_FENCE_LOCAL_TEST === '1' ? it : it.skip

localTest('v1 route가 실제 DB의 무효화된 claim에서 Storage를 호출하지 않는다', async () => {
  const result = await GET(new NextRequest('http://localhost/cron'))
  expect(result).toMatchObject({ scanned: 500, deleted: 0, remaining: 1 })
  expect(removeApplicantFiles).not.toHaveBeenCalled()
  const { prisma } = jest.requireMock('@/lib/prisma')
  await prisma.close()
})
