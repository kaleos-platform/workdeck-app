import { z } from 'zod'

export const leadInviteSchema = z.object({
  message: z.string().max(300, '메시지는 300자 이내로 입력해 주세요').trim().default(''),
})
