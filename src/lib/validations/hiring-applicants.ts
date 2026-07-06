// 지원자 관리 Deck — Zod 스키마 + 폼 필드 정의 파서.
// 공개 지원 폼은 posting.applicationEntries(폼 스키마)를 소비하고,
// 제출값은 ApplicationEntryValue[](src/lib/hiring/pii.ts) 형태로 서버에 전달한다.
import { z } from 'zod'

// ─── 폼 필드 정의(스키마) ──────────────────────────────────────────────────────
// posting.applicationEntries 원소. hiring-posts deck의 편집기가 생성한다.
// 방어적으로 파싱한다(타 agent 산출물 — 누락/미지 값 허용).

export const HIRING_FIELD_TYPES = [
  'string',
  'text',
  'number',
  'email',
  'phone',
  'date',
  'file',
  'select',
  'multiselect',
] as const

export type HiringFieldType = (typeof HIRING_FIELD_TYPES)[number]

export const hiringFieldDefSchema = z.object({
  key: z.string().min(1),
  type: z.enum(HIRING_FIELD_TYPES).catch('string'),
  label: z.string().min(1).catch('항목'),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
})

export type HiringFieldDef = z.infer<typeof hiringFieldDefSchema>

// 표준 PII 필드가 스키마에 없을 때 기본 제공(이름·연락처는 항상 필요)
export const DEFAULT_STANDARD_FIELDS: HiringFieldDef[] = [
  { key: 'name', type: 'string', label: '이름', required: true },
  { key: 'phone', type: 'phone', label: '연락처', required: true },
]

/**
 * posting.applicationEntries(unknown JSON)를 필드 정의 배열로 방어 파싱.
 * 유효 원소만 남기고, 이름/연락처가 없으면 기본 필드를 앞에 채운다.
 */
export function parseApplicationEntriesSchema(raw: unknown): HiringFieldDef[] {
  const arr = Array.isArray(raw) ? raw : []
  const parsed: HiringFieldDef[] = []
  const seen = new Set<string>()
  for (const item of arr) {
    const r = hiringFieldDefSchema.safeParse(item)
    if (!r.success) continue
    if (seen.has(r.data.key)) continue
    seen.add(r.data.key)
    parsed.push(r.data)
  }
  // 표준 필수 필드 보강
  const prepend: HiringFieldDef[] = []
  for (const def of DEFAULT_STANDARD_FIELDS) {
    if (!seen.has(def.key)) prepend.push(def)
  }
  return [...prepend, ...parsed]
}

// ─── 제출값(공개 지원) ─────────────────────────────────────────────────────────

// 값은 string | string[] | null 만 허용(파일은 별도 multipart, 값은 파일명 스냅샷)
const entryValueSchema = z.union([z.string(), z.array(z.string()), z.null()])

export const applicationEntrySchema = z.object({
  key: z.string().min(1),
  type: z.string().min(1),
  label: z.string().optional(),
  value: entryValueSchema,
})

export type SubmittedEntry = z.infer<typeof applicationEntrySchema>

// 공개 지원 제출 payload(멀티파트의 JSON 파트)
export const publicApplicationPayloadSchema = z.object({
  postingUuid: z.string().min(1),
  entries: z.array(applicationEntrySchema).max(50),
  postingPositionId: z.string().optional(),
  storeIds: z.array(z.string()).max(20).optional(),
  referrer: z.string().max(300).optional(),
  privacyAgreed: z.literal(true),
})

export type PublicApplicationPayload = z.infer<typeof publicApplicationPayloadSchema>

// ─── 고용주 콘솔 스키마 ─────────────────────────────────────────────────────────

export const APPLICATION_STAGES = ['HIRING', 'ACCEPTED', 'REJECTED'] as const
export const PROCESS_STAGES = ['APPLIED', 'INTERVIEW', 'JOB_OFFER'] as const
export const NOTIFICATION_TYPES = ['INTERVIEW', 'JOB_OFFER', 'ACCEPTED', 'REJECTED'] as const

export const updateApplicationSchema = z
  .object({
    stage: z.enum(APPLICATION_STAGES).optional(),
    hiringStage: z.enum(PROCESS_STAGES).optional(),
    memo: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => v.stage !== undefined || v.hiringStage !== undefined || v.memo !== undefined, {
    message: '변경할 값이 없습니다',
  })

export const bulkStageSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  stage: z.enum(APPLICATION_STAGES),
})

export const commentSchema = z.object({
  content: z.string().min(1).max(2000),
})

export const notificationSchema = z.object({
  notiType: z.enum(NOTIFICATION_TYPES),
  detailMessage: z.string().max(2000).optional(),
})

export const blacklistCreateSchema = z.object({
  phone: z.string().min(4).max(30),
  reason: z.string().max(500).optional(),
})

export const blacklistUpdateSchema = z.object({
  isActive: z.boolean(),
})

export const messageTemplateSchema = z.object({
  title: z.string().min(1).max(100),
  content: z.string().min(1).max(2000),
})
