import { z } from 'zod'

export const banUserSchema = z.object({
  ban: z.boolean(),
})

export const updateMembershipSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
})

// 운영자 구성원 추가 — OWNER는 받지 않는다(추가 뒤 PATCH로 승격).
export const addMembershipSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER']),
})

// 운영자 새 Space 생성 — 이름은 trim·NFC 로 정규화해 같은 이름 중복 판정에 쓴다.
export const createSpaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .transform((value) => value.normalize('NFC')),
  enableRecruiting: z.boolean().default(true),
})

export type BanUserInput = z.infer<typeof banUserSchema>
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>
