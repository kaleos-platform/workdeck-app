import { prisma } from '@/lib/prisma'

// 월 단위 AI 이미지 크레딧 관리.
// 2-phase: reserveImageCredit → (generate) → commitImageCredit / refundImageCredit.
// reserve 는 atomic UPDATE ... WHERE imageUsed < imageQuota 로 double-spend 방지.

export const DEFAULT_IMAGE_MONTHLY_QUOTA = Number(
  process.env.SALES_CONTENT_IMAGE_MONTHLY_QUOTA ?? 50
)

export class CreditExceededError extends Error {
  readonly code = 'CREDIT_EXCEEDED' as const
  constructor(public readonly yearMonth: string) {
    super(`월간 이미지 크레딧(${yearMonth})이 소진되었습니다`)
  }
}

// UTC 기준 YYYY-MM (공유 DB이므로 타임존 일관성 확보)
export function currentYearMonth(now: Date = new Date()): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export interface ImageReservation {
  reservationId: string // ImageGenerationLog.id
  yearMonth: string
  imageUsedAfter: number
  imageQuota: number
}

export interface ReserveInput {
  spaceId: string
  userId?: string | null
  provider: string
  model: string
  prompt: string
  negativePrompt?: string | null
  aspectRatio?: string | null
  now?: Date
}

// 월간 크레딧 row 를 보장. 동시성 안전하게 upsert.
async function ensureCreditRow(spaceId: string, yearMonth: string): Promise<void> {
  await prisma.workspaceAiCredit.upsert({
    where: { spaceId_yearMonth: { spaceId, yearMonth } },
    create: { spaceId, yearMonth, imageUsed: 0, imageQuota: DEFAULT_IMAGE_MONTHLY_QUOTA },
    update: {},
  })
}

// 크레딧 1장 예약. 쿼터 초과 시 CreditExceededError 던짐.
export async function reserveImageCredit(input: ReserveInput): Promise<ImageReservation> {
  const yearMonth = currentYearMonth(input.now)
  await ensureCreditRow(input.spaceId, yearMonth)

  // atomic: imageUsed + 1 WHERE imageUsed < imageQuota
  const updated = await prisma.$executeRaw`
    UPDATE "WorkspaceAiCredit"
    SET "imageUsed" = "imageUsed" + 1, "updatedAt" = NOW()
    WHERE "spaceId" = ${input.spaceId}
      AND "yearMonth" = ${yearMonth}
      AND "imageUsed" < "imageQuota"
  `
  if (updated === 0) throw new CreditExceededError(yearMonth)

  const credit = await prisma.workspaceAiCredit.findUnique({
    where: { spaceId_yearMonth: { spaceId: input.spaceId, yearMonth } },
    select: { imageUsed: true, imageQuota: true },
  })

  const log = await prisma.imageGenerationLog.create({
    data: {
      spaceId: input.spaceId,
      userId: input.userId ?? null,
      provider: input.provider,
      model: input.model,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt ?? null,
      aspectRatio: input.aspectRatio ?? null,
      creditMonth: yearMonth,
      status: 'PENDING',
    },
    select: { id: true },
  })

  return {
    reservationId: log.id,
    yearMonth,
    imageUsedAfter: credit?.imageUsed ?? 0,
    imageQuota: credit?.imageQuota ?? DEFAULT_IMAGE_MONTHLY_QUOTA,
  }
}

// 성공 확정. imageUsed 은 그대로 두고 로그 상태만 전환.
export async function commitImageCredit(
  reservationId: string,
  meta: { outputCount: number }
): Promise<void> {
  await prisma.imageGenerationLog.update({
    where: { id: reservationId },
    data: { status: 'SUCCEEDED', outputCount: meta.outputCount },
  })
}

// 실패 환불. 같은 월에 한해서만 imageUsed 감소 (월이 바뀐 뒤 환불은 창조 방지).
// 로그 상태가 이미 최종(SUCCEEDED/FAILED/REFUNDED)이면 멱등 no-op.
export async function refundImageCredit(
  reservationId: string,
  meta: { errorCode?: string; errorMessage?: string }
): Promise<void> {
  const log = await prisma.imageGenerationLog.findUnique({
    where: { id: reservationId },
    select: { spaceId: true, creditMonth: true, status: true },
  })
  if (!log) return
  if (log.status !== 'PENDING') return

  const thisMonth = currentYearMonth()
  if (log.creditMonth && log.creditMonth === thisMonth) {
    await prisma.$executeRaw`
      UPDATE "WorkspaceAiCredit"
      SET "imageUsed" = GREATEST("imageUsed" - 1, 0), "updatedAt" = NOW()
      WHERE "spaceId" = ${log.spaceId} AND "yearMonth" = ${log.creditMonth}
    `
  }

  await prisma.imageGenerationLog.update({
    where: { id: reservationId },
    data: {
      status: 'REFUNDED',
      errorCode: meta.errorCode ?? null,
      errorMessage: meta.errorMessage ?? null,
    },
  })
}

// 읽기 전용. 현재 월 사용량 조회.
export async function getMonthUsage(
  spaceId: string,
  yearMonth: string = currentYearMonth()
): Promise<{
  yearMonth: string
  imageUsed: number
  imageQuota: number
  textTokensUsed: number
  textTokenQuota: number
}> {
  const credit = await prisma.workspaceAiCredit.findUnique({
    where: { spaceId_yearMonth: { spaceId, yearMonth } },
    select: {
      imageUsed: true,
      imageQuota: true,
      textTokensUsed: true,
      textTokenQuota: true,
    },
  })
  return {
    yearMonth,
    imageUsed: credit?.imageUsed ?? 0,
    imageQuota: credit?.imageQuota ?? DEFAULT_IMAGE_MONTHLY_QUOTA,
    textTokensUsed: credit?.textTokensUsed ?? 0,
    textTokenQuota: credit?.textTokenQuota ?? DEFAULT_TEXT_MONTHLY_TOKEN_QUOTA,
  }
}

// ─── 텍스트 토큰 쿼터 (워크덱 제공 AI 전용) ──────────────────────────────────
//
// 이미지와 달리 호출 전에 소비량을 알 수 없다. 그래서 2-phase 예약이 아니라
// "호출 전 잔량 확인 → 호출 후 실제 usage 로 사후 정산" 방식이다.
// 마지막 호출이 쿼터를 넘겨 끝날 수 있으나(최대 1회분 초과), 사용자를 중간에
// 끊지 않는 편이 UX 상 낫고 다음 호출에서 차단되므로 허용 오차로 둔다.
// BYOK 모드는 사용자가 비용을 부담하므로 이 경로를 아예 타지 않는다.

export const DEFAULT_TEXT_MONTHLY_TOKEN_QUOTA = Number(
  process.env.WORKDECK_TEXT_MONTHLY_TOKEN_QUOTA ?? 300_000
)

export class TextQuotaExceededError extends Error {
  readonly code = 'TEXT_QUOTA_EXCEEDED' as const
  constructor(
    public readonly yearMonth: string,
    public readonly used: number,
    public readonly quota: number
  ) {
    super(`월간 AI 텍스트 사용량(${yearMonth})을 모두 사용했습니다`)
  }
}

/** 호출 전 잔량 확인. 소진 상태면 TextQuotaExceededError. */
export async function checkTextQuota(
  spaceId: string,
  now?: Date
): Promise<{ yearMonth: string; used: number; quota: number }> {
  const yearMonth = currentYearMonth(now)
  await ensureCreditRow(spaceId, yearMonth)
  const credit = await prisma.workspaceAiCredit.findUnique({
    where: { spaceId_yearMonth: { spaceId, yearMonth } },
    select: { textTokensUsed: true, textTokenQuota: true },
  })
  const used = credit?.textTokensUsed ?? 0
  const quota = credit?.textTokenQuota ?? DEFAULT_TEXT_MONTHLY_TOKEN_QUOTA
  if (used >= quota) throw new TextQuotaExceededError(yearMonth, used, quota)
  return { yearMonth, used, quota }
}

/** 호출 후 실제 토큰을 누적. usage 를 못 얻은 provider 는 0 이 들어와 no-op 이 된다. */
export async function recordTextUsage(
  spaceId: string,
  tokens: { inputTokens?: number; outputTokens?: number },
  now?: Date
): Promise<void> {
  const total = (tokens.inputTokens ?? 0) + (tokens.outputTokens ?? 0)
  if (total <= 0) return
  const yearMonth = currentYearMonth(now)
  await ensureCreditRow(spaceId, yearMonth)
  await prisma.$executeRaw`
    UPDATE "WorkspaceAiCredit"
    SET "textTokensUsed" = "textTokensUsed" + ${total}, "updatedAt" = NOW()
    WHERE "spaceId" = ${spaceId} AND "yearMonth" = ${yearMonth}
  `
}
