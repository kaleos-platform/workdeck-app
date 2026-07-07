import { z } from 'zod'

// ─── 공용 ─────────────────────────────────────────────────────────────────────
// id 검증: cuid(신규) + uuid(레거시) 모두 허용. 실제 소속 검증은 서버 findFirst.
const idLike = z.string().min(8).max(64)

// 빈 문자열/null 을 undefined 로 정규화하는 전처리기
const emptyToUndefined = z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string())

const optionalText = (max = 5000) => emptyToUndefined.pipe(z.string().max(max)).optional()

const optionalInt = z
  .preprocess(
    (v) => (v === null || v === '' || v === undefined ? undefined : Number(v)),
    z.number().int().nonnegative()
  )
  .optional()

// "HH:mm" 형식 (근무 시간)
const timeString = z
  .preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '시간 형식은 HH:mm 이어야 합니다')
  )
  .optional()

// ─── enum ─────────────────────────────────────────────────────────────────────
export const jobTypeEnum = z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'FREELANCER', 'INTERN'])
export const payFrequencyEnum = z.enum([
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
  'PER_TASK',
  'TBD',
])

// ─── 공고 ─────────────────────────────────────────────────────────────────────
export const createPostingSchema = z.object({
  title: optionalText(200),
})
export type CreatePostingInput = z.infer<typeof createPostingSchema>

export const updatePostingSchema = z.object({
  title: emptyToUndefined.pipe(z.string().min(1, '제목을 입력하세요').max(200)).optional(),
  closingDate: z
    .preprocess((v) => (v === null || v === '' ? null : v), z.union([z.string(), z.null()]))
    .optional(),
  notificationEnabled: z.boolean().optional(),
})
export type UpdatePostingInput = z.infer<typeof updatePostingSchema>

// 발행/마감/재개 액션
export const postingActionSchema = z.object({
  action: z.enum(['publish', 'close', 'reopen', 'archive']),
})
export type PostingActionInput = z.infer<typeof postingActionSchema>

// ─── 직무 (PostingPosition) ────────────────────────────────────────────────────
export const postingPositionSchema = z.object({
  name: z.string().min(1, '직무명을 입력하세요').max(200),
  positionId: emptyToUndefined.pipe(idLike).optional(),
  jobType: jobTypeEnum.optional(),
  payFrequency: payFrequencyEnum.optional(),
  payAmount: optionalInt,
  // 근무 요일 int[] (0=일 … 6=토)
  workDays: z.array(z.number().int().min(0).max(6)).optional(),
  workStartAt: timeString,
  workEndAt: timeString,
  headcount: optionalInt,
  experience: optionalText(200),
  education: optionalText(200),
  jobDescription: optionalText(),
  requiredQualifications: optionalText(),
  preferredQualifications: optionalText(),
})
export type PostingPositionInput = z.infer<typeof postingPositionSchema>

// ─── 매장 (Store) ──────────────────────────────────────────────────────────────
export const storeSchema = z.object({
  name: z.string().min(1, '매장명을 입력하세요').max(200),
  roadAddress: optionalText(300),
  detailAddress: optionalText(300),
  zipcode: optionalText(20),
  isActive: z.boolean().optional(),
})
export type StoreInput = z.infer<typeof storeSchema>

// 공고에 매장 연결/해제
export const linkStoresSchema = z.object({
  storeIds: z.array(idLike),
})
export type LinkStoresInput = z.infer<typeof linkStoresSchema>

// ─── 직무 기준정보 (Position) ──────────────────────────────────────────────────
export const positionSchema = z.object({
  name: z.string().min(1, '직무명을 입력하세요').max(200),
  category: optionalText(100),
  isActive: z.boolean().optional(),
})
export type PositionInput = z.infer<typeof positionSchema>

// ─── 상세 콘텐츠 블록 ──────────────────────────────────────────────────────────
// contentType: 'text' — Tiptap JSON, 'image' — Supabase 업로드 이미지
export const contentTypeEnum = z.enum(['image', 'text'])

export const createContentSchema = z.object({
  contentType: contentTypeEnum,
  sortOrder: z.number().int().optional(),
})
export type CreateContentInput = z.infer<typeof createContentSchema>

export const updateContentSchema = z.object({
  // text 블록 전용 — Tiptap doc JSON. z.record/z.any 대신 z.unknown() 사용:
  // Tiptap JSON 형태는 { type, content, ... } 이지만 버전별 shape 변동이 있으므로
  // 서버는 저장만 담당하고 구조 검증은 하지 않는다.
  data: z.unknown().optional(),
  // image 블록 전용 — base64 data URL 또는 순수 base64. MAX_ASSET_BYTES(10MB) 기준
  // base64 인코딩 오버헤드(~33%)를 감안해 13.5MB 문자 길이 상한 적용
  imageBase64: emptyToUndefined.pipe(z.string().max(Math.ceil(10 * 1024 * 1024 * 1.35))).optional(),
  mimeType: emptyToUndefined.pipe(z.string()).optional(),
  sortOrder: z.number().int().optional(),
})
export type UpdateContentInput = z.infer<typeof updateContentSchema>

// ─── 지원서 폼 스키마 (applicationEntries) ─────────────────────────────────────
// ⚠️ 표준 PII 키는 pii.ts 의 PII_ENTRY_KEYS 와 정확히 일치해야 한다: name/phone/email/address
export const formFieldTypeEnum = z.enum(['string', 'text', 'select', 'file', 'email', 'phone'])

export const formFieldSchema = z.object({
  key: z.string().min(1).max(64),
  type: formFieldTypeEnum,
  label: z.string().min(1, '항목 이름을 입력하세요').max(100),
  required: z.boolean(),
  options: z.array(z.string().max(100)).optional(),
})
export type FormFieldInput = z.infer<typeof formFieldSchema>

export const updateFormSchema = z.object({
  fields: z.array(formFieldSchema),
})
export type UpdateFormInput = z.infer<typeof updateFormSchema>

// ─── 상세 템플릿 ───────────────────────────────────────────────────────────────
export const updateTemplateSchema = z.object({
  name: z.string().min(1, '템플릿 이름을 입력하세요').max(200),
})
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>

// 위저드 상세 스텝에서 "템플릿으로 저장" — 공고의 콘텐츠 블록을 복제해 템플릿 생성
export const createTemplateSchema = z.object({
  name: z.string().min(1, '템플릿 이름을 입력하세요').max(200),
  postingId: idLike,
})
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>
