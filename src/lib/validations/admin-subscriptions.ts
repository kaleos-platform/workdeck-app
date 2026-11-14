import { z } from 'zod'

// 선택한 한국 날짜의 말일까지 허용하고, 다음 날 00:00 KST부터 만료한다.
export function trialEndOfKstDay(day: string): Date {
  return new Date(new Date(`${day}T00:00:00+09:00`).getTime() + 86_400_000)
}

const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => {
    const date = new Date(`${day}T00:00:00Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day
  }, '유효한 날짜가 필요합니다')
const noteSchema = z.string().trim().min(1).max(500)

export const adminSubscriptionPatchSchema = z.union([
  z.object({ trialEndsOn: daySchema, note: noteSchema }).strict(),
  z.object({ exempt: z.boolean(), note: noteSchema }).strict(),
])
export type AdminSubscriptionPatch = z.infer<typeof adminSubscriptionPatchSchema>
