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
  return prisma.browserWriteJob.findUnique({
    where: { id: candidate.id },
    select: {
      id: true,
      actionId: true,
      spaceId: true,
      payload: true,
      claimId: true,
      expiresAt: true,
    },
  })
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
  const job = await prisma.browserWriteJob.findFirst({ where, select: { payload: true } })
  if (!job) throw new ToolUserError('이 토큰이 실행 중인 작업이 아닙니다')
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
    data: { status: report.outcome, report, finishedAt: new Date() },
  })
  if (gate.count !== 1) throw new ToolUserError('이미 보고된 작업입니다. 재실행하지 마세요')
  return { jobId: id, browserStatus: report.outcome }
}
