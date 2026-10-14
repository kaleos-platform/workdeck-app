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

export type BanUserInput = z.infer<typeof banUserSchema>
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>
