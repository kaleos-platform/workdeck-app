import { z } from 'zod'

// ─── POST /api/bo/posts ───────────────────────────────────────────────────────

export const createBoPostBodySchema = z.object({
  materialId: z.string().min(1),
})

// ─── PATCH /api/bo/posts/[id] ────────────────────────────────────────────────
// 두 가지 모드가 상호 배타적: content 편집(title/doc) vs status 전환(status).

export const patchBoPostBodySchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    doc: z.unknown().optional(),
    status: z
      .enum([
        'GENERATING',
        'DRAFT',
        'IN_REVIEW',
        'PUBLISH_APPROVED',
        'PUBLISHED',
        'FAILED',
        'ARCHIVED',
      ])
      .optional(),
  })
  .refine((d) => !((d.doc !== undefined || d.title !== undefined) && d.status !== undefined), {
    message: 'content 편집과 status 전환은 동시에 요청할 수 없습니다',
  })

export type PatchBoPostBody = z.infer<typeof patchBoPostBodySchema>

// ─── POST /api/bo/posts/[id]/regenerate ──────────────────────────────────────

export const regenerateBoPostBodySchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('full') }),
  z.object({
    scope: z.literal('section'),
    heading: z.string().min(1),
    instruction: z.string().max(2000).optional(),
  }),
])

export type RegenerateBoPostBody = z.infer<typeof regenerateBoPostBodySchema>

// ─── POST /api/bo/posts/[id]/versions ────────────────────────────────────────

export const restoreBoPostVersionBodySchema = z.object({
  versionNumber: z.number().int().min(1),
})

export type RestoreBoPostVersionBody = z.infer<typeof restoreBoPostVersionBodySchema>
