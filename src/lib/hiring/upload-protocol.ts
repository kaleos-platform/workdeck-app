import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { MAX_FORM_FILES, MAX_FORM_FILE_BYTES } from './file-fields'
import { publicApplicationPayloadSchema } from '@/lib/validations/hiring-applicants'

export const uploadFileSchema = z.object({
  fieldKey: z.string().min(1).max(64),
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(150),
  sizeBytes: z.number().int().min(1).max(MAX_FORM_FILE_BYTES),
})
export const uploadIntentSchema = z.object({
  postingUuid: z.string().min(1),
  files: z.array(uploadFileSchema).min(1).max(MAX_FORM_FILES),
})
export const completeUploadSchema = publicApplicationPayloadSchema.extend({
  uploadSessionId: z.string().uuid(),
  uploadToken: z.string().regex(/^[a-f0-9]{64}$/),
})
export const storedUploadFileSchema = uploadFileSchema.extend({
  id: z.string().uuid(),
  path: z.string().min(1),
})
export const storedUploadFilesSchema = z.array(storedUploadFileSchema).min(1).max(MAX_FORM_FILES)
export type StoredUploadFile = z.infer<typeof storedUploadFileSchema>
export function uploadTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}
export function newUploadToken() {
  return randomBytes(32).toString('hex')
}
// 입력 원문은 출력하지 않고 재시도의 동일성만 확인한다.
export function submissionHash(payload: z.infer<typeof publicApplicationPayloadSchema>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        postingUuid: payload.postingUuid,
        entries: payload.entries,
        postingPositionId: payload.postingPositionId ?? null,
        storeIds: payload.storeIds ?? [],
        referrer: payload.referrer ?? null,
        privacyAgreed: payload.privacyAgreed,
      })
    )
    .digest('hex')
}
