import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateWorker, workerOwns } from '@/lib/worker-auth'
import { decodeMigrationSnapshot } from '@/lib/hiring/migration/ledger'
import { recoverOpeningPosting } from '@/lib/hiring/migration/posting-recovery'
import { auditMigrationRecords } from '@/lib/hiring/migration/runtime-audit'

export const runtime = 'nodejs'
export const maxDuration = 30

// 승인된 파일럿 계정만 검사한다. 임의 이메일·spaceId 입력은 받지 않는다.
const accounts = { ameaning: 'hello@ameaning.co.kr', peakpay: 'devops@workdeck.work' } as const
const boundary = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const inputSchema = z
  .object({
    customer: z.enum(['ameaning', 'peakpay']),
    after: boundary.optional(),
    through: boundary.optional(),
  })
  .strict()
  .refine((x) => !x.after || (x.through !== undefined && x.after < x.through))
const respond = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof authenticateWorker>>
  try {
    auth = await authenticateWorker(request.headers, { touchLastUsed: false })
  } catch {
    return respond({ code: 'MIGRATION_AUDIT_FAILED' }, 500)
  }
  if ('error' in auth) {
    auth.error.headers.set('Cache-Control', 'private, no-store')
    return auth.error
  }
  let raw: unknown
  try {
    const text = await request.text()
    if (Buffer.byteLength(text) > 2048) return respond({ code: 'INVALID_AUDIT_INPUT' }, 413)
    raw = JSON.parse(text)
  } catch {
    return respond({ code: 'INVALID_AUDIT_INPUT' }, 400)
  }
  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) return respond({ code: 'INVALID_AUDIT_INPUT' }, 400)
  const input = parsed.data
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
        const readOnly = await tx.$queryRawUnsafe<Array<{ transaction_read_only: string }>>(
          'SHOW transaction_read_only'
        )
        if (readOnly[0]?.transaction_read_only !== 'on') throw Error('READ_ONLY_REQUIRED')
        const memberships = await tx.spaceMember.findMany({
          where: { user: { email: accounts[input.customer] } },
          select: { spaceId: true, role: true },
        })
        if (memberships.length !== 1 || memberships[0].role !== 'OWNER')
          throw Error('AUDIT_SCOPE_UNAVAILABLE')
        const spaceId = memberships[0].spaceId
        if (!workerOwns(auth.scope, { spaceId })) throw Error('AUDIT_SCOPE_FORBIDDEN')
        const upper =
          input.through ??
          (
            await tx.hiringMigrationRecord.findFirst({
              where: { spaceId },
              orderBy: { id: 'desc' },
              select: { id: true },
            })
          )?.id
        if (!upper)
          return {
            customer: input.customer,
            total: 0,
            through: null,
            next: null,
            summary: auditMigrationRecords([], { spaceId, sourceSpaceId: '' }),
          }
        const where = { spaceId, id: { lte: upper } }
        const total = await tx.hiringMigrationRecord.count({ where })
        const anchor = await tx.hiringMigrationRecord.findFirst({
          where: { ...where, targetModel: 'HiringPosting' },
          orderBy: { id: 'asc' },
        })
        if (!anchor) throw Error('AUDIT_ANCHOR_REQUIRED')
        const stored = decodeMigrationSnapshot(anchor)
        if (
          !stored ||
          typeof stored !== 'object' ||
          !('sourceSpaceId' in stored) ||
          typeof stored.sourceSpaceId !== 'string' ||
          !/^[1-9]\d{0,18}$/.test(stored.sourceSpaceId)
        )
          throw Error('AUDIT_ANCHOR_INVALID')
        const scope = { spaceId, sourceSpaceId: stored.sourceSpaceId }
        recoverOpeningPosting(anchor, scope)
        const records = await tx.hiringMigrationRecord.findMany({
          where: { ...where, id: { lte: upper, ...(input.after ? { gt: input.after } : {}) } },
          orderBy: { id: 'asc' },
          take: 26,
        })
        const batch = records.slice(0, 25)
        return {
          customer: input.customer,
          total,
          through: upper,
          next: records.length > 25 ? batch.at(-1)!.id : null,
          summary: auditMigrationRecords(batch, scope),
        }
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000, maxWait: 5000 }
    )
    return respond(result)
  } catch (error) {
    // 예외 원문에는 접속 정보나 고객 원문이 포함될 수 있어 로그·응답에 전달하지 않는다.
    return respond(
      { code: 'MIGRATION_AUDIT_FAILED' },
      error instanceof Error && error.message === 'AUDIT_SCOPE_UNAVAILABLE'
        ? 409
        : error instanceof Error && error.message === 'AUDIT_SCOPE_FORBIDDEN'
          ? 403
          : 500
    )
  }
}
