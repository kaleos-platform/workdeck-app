import { z } from 'zod'
import type { UserFeedbackStatus, UserFeedbackType } from '@/generated/prisma/enums'

export const FEEDBACK_TYPES = ['FEATURE', 'BUG', 'QUESTION', 'REVIEW', 'OTHER'] as const satisfies readonly UserFeedbackType[]
export const FEEDBACK_STATUSES = ['NEW', 'IN_PROGRESS', 'DONE', 'ON_HOLD'] as const satisfies readonly UserFeedbackStatus[]

export const FEEDBACK_TYPE_LABEL: Record<UserFeedbackType, string> = {
  FEATURE: '기능 제안',
  BUG: '서비스 오류',
  QUESTION: '문의',
  REVIEW: '이용 후기',
  OTHER: '기타',
}

export const FEEDBACK_STATUS_LABEL: Record<UserFeedbackStatus, string> = {
  NEW: '접수',
  IN_PROGRESS: '확인 중',
  DONE: '완료',
  ON_HOLD: '보류',
}

export const MAX_FILES = 3
export const MAX_FILE_BYTES = 1_048_576

export const DAY_MS = 86_400_000
export const RETENTION_DAYS: Partial<Record<UserFeedbackStatus, number>> = { DONE: 30, ON_HOLD: 90 }

const pagePathSchema = z
  .string()
  .transform((v) => v.split(/[?#]/)[0])
  .pipe(z.string().startsWith('/').max(500))

export const feedbackInputSchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  body: z.string().trim().min(1).max(5000),
  pagePath: pagePathSchema.optional(),
})

export const adminUpdateSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  memo: z.string().max(2000).nullable().optional(),
})

const isClosed = (s: UserFeedbackStatus) => s === 'DONE' || s === 'ON_HOLD'

/** 종료 상태 진입 시각. 같은 종료 상태 유지(메모 저장)는 기존 값, 비종료로 이동하면 null(삭제 예약 취소). */
export function nextClosedAt(
  current: UserFeedbackStatus,
  next: UserFeedbackStatus,
  currentClosedAt: Date | null,
  now: Date,
): Date | null {
  if (!isClosed(next)) return null
  if (current === next && currentClosedAt) return currentClosedAt
  return now
}

export function attachmentDeleteAt(status: UserFeedbackStatus, closedAt: Date | null): Date | null {
  const days = RETENTION_DAYS[status]
  if (!days || !closedAt) return null
  return new Date(closedAt.getTime() + days * DAY_MS)
}

/** 잘못된 값(비정수·음수·비숫자)은 0 = 첨부 끔. 미설정은 500 MiB. */
export function storageCapBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = env.FEEDBACK_STORAGE_CAP_MB
  if (raw === undefined || raw.trim() === '') return 500 * 1024 * 1024
  return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) * 1024 * 1024 : 0
}
