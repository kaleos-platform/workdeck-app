import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ToolUserError } from '@/lib/agent/tools/errors'

export const BROWSER_ROUNDTRIP_ACTION = 'seller-hub.browser.dev-marker-roundtrip'
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)

// 임의 HTML·JS 대신 승인 화면에 전부 표시할 수 있는 고정 주석만 받는다.
export const roundtripParams = z.strictObject({
  identity: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  mallId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  shopNo: z.number().int().positive(),
  skinNo: z.number().int().positive(),
  skinCode: z.string().regex(/^skin[0-9]+$/),
  file: z.literal('/index.html'),
  originalSha256: sha256,
  markerId: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)
    .refine((s) => !s.includes('--')),
})
export type RoundtripParams = z.infer<typeof roundtripParams>

export function markerDiff(params: RoundtripParams): string {
  return `\n<!-- workdeck-ego-check:${params.markerId} -->\n`
}

export const browserWriteReport = z.strictObject({
  claimId: z.string().min(1).max(100),
  outcome: z.enum(['RESTORED', 'ABORTED', 'UNCERTAIN']),
  originalSha256: sha256.optional(),
  writtenSha256: sha256.optional(),
  restoredSha256: sha256.optional(),
  taskSpaceId: z.number().int().positive().nullable(),
  taskSpaceFinished: z.boolean(),
})

export const recoverUnstartedInput = z.strictObject({
  claimId: z.string().min(1).max(100),
})

const unstartedReport = browserWriteReport.refine(
  (report) =>
    report.outcome === 'ABORTED' &&
    report.taskSpaceId === null &&
    report.taskSpaceFinished &&
    !report.writtenSha256 &&
    !report.restoredSha256,
  '브라우저와 저장을 시작하지 않은 중단 보고서만 복구할 수 있습니다'
)
const recoveryMetadata = z
  .strictObject({
    attempt: z.literal(1),
    previousReport: unstartedReport,
    recoveredAt: z.iso.datetime(),
    tokenId: z.string().min(1),
    claimId: z.string().min(1).max(100),
  })
  .refine((value) => value.claimId === value.previousReport.claimId)
const recoveredReport = browserWriteReport.extend({ recovery: recoveryMetadata })

function persistedRecovery(report: unknown) {
  if (report == null) return undefined
  const original = browserWriteReport.safeParse(report)
  if (original.success) return undefined
  // 손상된 이력은 일반 작업으로 간주하지 않고 닫힌 상태로 거부한다.
  return recoveredReport.parse(report).recovery
}

export async function recoverUnstartedBrowserWrite(
  spaceId: string,
  tokenId: string,
  id: string,
  input: unknown
) {
  const { claimId } = recoverUnstartedInput.parse(input)
  const now = new Date()
  const where = {
    id,
    spaceId,
    status: 'ABORTED' as const,
    claimedByTokenId: tokenId,
    claimId,
    expiresAt: { gt: now },
    action: { status: 'EXECUTED' as const },
  }
  const job = await prisma.browserWriteJob.findFirst({ where, select: { report: true } })
  const previous = unstartedReport.safeParse(job?.report)
  if (!previous.success || previous.data.claimId !== claimId)
    throw new ToolUserError('미시작·미만료 작업의 최초 소유자만 한 번 복구할 수 있습니다')
  const recoveredAt = new Date()
  const gate = await prisma.browserWriteJob.updateMany({
    where: { ...where, expiresAt: { gt: recoveredAt }, report: { equals: previous.data } },
    data: {
      status: 'PENDING',
      finishedAt: null,
      claimedAt: null,
      claimedByTokenId: null,
      claimId: null,
      // 기존 승인·payload·expiresAt은 유지하며 서버만 복구 이력을 작성한다.
      report: {
        ...previous.data,
        recovery: {
          attempt: 1,
          previousReport: previous.data,
          recoveredAt: recoveredAt.toISOString(),
          tokenId,
          claimId,
        },
      },
    },
  })
  if (gate.count !== 1) throw new ToolUserError('복구 상태가 바뀌었습니다. 재실행하지 마세요')
  return { jobId: id, browserStatus: 'PENDING', recoveryAttempt: 1 }
}

export async function enqueueBrowserWrite(
  spaceId: string,
  actionId: string,
  params: RoundtripParams
) {
  const payload = roundtripParams.parse(params)
  const action = await prisma.agentPendingAction.findFirst({
    where: { id: actionId, spaceId, actionType: BROWSER_ROUNDTRIP_ACTION, status: 'APPROVED' },
    select: { payload: true, decidedBy: true },
  })
  if (
    !action?.decidedBy ||
    JSON.stringify(roundtripParams.parse(action.payload)) !== JSON.stringify(payload)
  ) {
    throw new ToolUserError('승인된 대상과 브라우저 작업이 일치하지 않습니다')
  }
  const job = await prisma.browserWriteJob.create({
    data: { spaceId, actionId, payload, expiresAt: new Date(Date.now() + 15 * 60_000) },
    select: { id: true },
  })
  return {
    jobId: job.id,
    browserStatus: 'PENDING',
    message: '승인된 작업을 접수했습니다. 외부 저장은 아직 실행되지 않았습니다.',
  }
}

export async function claimBrowserWrite(spaceId: string, tokenId: string) {
  const now = new Date()
  await prisma.browserWriteJob.updateMany({
    where: { spaceId, status: 'PENDING', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  })
  const candidate = await prisma.browserWriteJob.findFirst({
    where: { spaceId, status: 'PENDING', expiresAt: { gt: now }, action: { status: 'EXECUTED' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!candidate) return null
  const gate = await prisma.browserWriteJob.updateMany({
    where: {
      id: candidate.id,
      spaceId,
      status: 'PENDING',
      expiresAt: { gt: now },
      action: { status: 'EXECUTED' },
    },
    data: { status: 'RUNNING', claimedAt: now, claimedByTokenId: tokenId, claimId: randomUUID() },
  })
  if (gate.count !== 1) return null
  // RUNNING은 lease 만료로 PENDING으로 돌리지 않는다. 응답 유실도 사람의 검토 대상이다.
  const job = await prisma.browserWriteJob.findUnique({
    where: { id: candidate.id },
    select: {
      id: true,
      actionId: true,
      spaceId: true,
      payload: true,
      claimId: true,
      expiresAt: true,
      report: true,
    },
  })
  if (!job) return null
  const { report, ...claimed } = job
  return { ...claimed, recoveryAttempt: persistedRecovery(report) ? 1 : 0 }
}

export async function reportBrowserWrite(
  spaceId: string,
  tokenId: string,
  id: string,
  input: unknown
) {
  const report = browserWriteReport.parse(input)
  const where = {
    id,
    spaceId,
    status: 'RUNNING' as const,
    claimedByTokenId: tokenId,
    claimId: report.claimId,
  }
  const job = await prisma.browserWriteJob.findFirst({
    where,
    select: { payload: true, report: true },
  })
  if (!job) throw new ToolUserError('이 토큰이 실행 중인 작업이 아닙니다')
  const recovery = persistedRecovery(job.report)
  const params = roundtripParams.parse(job.payload)
  if (
    report.outcome === 'RESTORED' &&
    (report.originalSha256 !== params.originalSha256 ||
      report.restoredSha256 !== params.originalSha256 ||
      !report.writtenSha256 ||
      report.writtenSha256 === params.originalSha256 ||
      !report.taskSpaceFinished ||
      report.taskSpaceId === null)
  )
    throw new ToolUserError('원본·저장·복원 해시와 TaskSpace 정리 확인이 필요합니다')
  const gate = await prisma.browserWriteJob.updateMany({
    where,
    data: {
      status: report.outcome,
      report: recovery ? { ...report, recovery } : report,
      finishedAt: new Date(),
    },
  })
  if (gate.count !== 1) throw new ToolUserError('이미 보고된 작업입니다. 재실행하지 마세요')
  return { jobId: id, browserStatus: report.outcome }
}
