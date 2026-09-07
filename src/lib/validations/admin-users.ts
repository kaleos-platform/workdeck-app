import { z } from 'zod'

export const banUserSchema = z.object({
  ban: z.boolean(),
})

export const updateMembershipSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
})

export type BanUserInput = z.infer<typeof banUserSchema>
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>
