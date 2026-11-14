/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import { removeCleanupFiles } from '@/lib/hiring/cleanup-storage'
jest.mock('@/lib/cron/with-cron-run', () => ({ withCronRun: (_: string, fn: unknown) => fn }))
jest.mock('@/lib/hiring/cleanup-storage', () => ({ removeCleanupFiles: jest.fn() }))
const localTest = process.env.WORKDECK_CLEANUP_LOCAL_TEST === '1' ? it : it.skip

localTest('삭제 실패와 늦은 PUT 이후에도 은퇴 상태를 보존하고 다시 지운다', async () => {
  const id = '00000000-0000-4000-8000-000000000005'
  const path = `cabcdefghijklmnopqrstuvwx/applications/${id}/00000000-0000-4000-8000-000000000002.pdf`
  const objects = new Set([path])
  ;(removeCleanupFiles as jest.Mock).mockRejectedValueOnce(Error('private@example.test')).mockImplementation(async (paths: string[]) => {
    for (const entry of paths) objects.delete(entry)
  })
  const failed = await GET(new NextRequest('http://localhost/cleanup'))
  expect(failed).toMatchObject({ status: 'partial', failed: 1 })
  expect(JSON.stringify(failed)).not.toContain('private@example.test')
  const rows = await prisma.$queryRaw<Array<{ retired: boolean }>>`SELECT "retiredAt" IS NOT NULL AS retired FROM "HiringUploadCleanup" WHERE id=${id}`
  expect(rows[0].retired).toBe(true)
  await prisma.$executeRaw`UPDATE "HiringUploadCleanup" SET "checkedAt"=now()-interval '2 hours' WHERE id=${id}`
  const success = await GET(new NextRequest('http://localhost/cleanup'))
  expect(success).toMatchObject({ status: 'ok', deleteCallsSucceeded: 1 })
  expect(objects.has(path)).toBe(false)
  objects.add(path)
  await prisma.$executeRaw`UPDATE "HiringUploadCleanup" SET "checkedAt"=now()-interval '2 hours' WHERE id=${id}`
  await GET(new NextRequest('http://localhost/cleanup'))
  expect(objects.has(path)).toBe(false)
  await prisma.$disconnect()
})
