// 서버/이전 도구 전용 순수 변환. DB·파일·암호화·알림 부작용은 없다.
import { MAX_FORM_FILES, MAX_FORM_FILE_BYTES } from './file-fields'
import { scalarFieldError } from './form-values'
import { createHash } from 'node:crypto'
import { formFieldSchema, type FormFieldInput } from '@/lib/validations/hiring-posts'
import type { ApplicationEntryValue } from './pii'
import {
  parseApplicationEntriesSchema,
  publicApplicationPayloadSchema,
} from '@/lib/validations/hiring-applicants'

type Failure = { ok: false; code: string; index?: number }
type Mapping = { identity: string; field: FormFieldInput; options: Map<string, string> }
type Plan = { ok: true; fields: FormFieldInput[]; mappings: Mapping[] } | Failure
const standardKeys = new Set(['name', 'phone', 'email', 'address'])
const supportedTypes = new Set([
  'number',
  'date',
  'string',
  'text',
  'select',
  'multiselect',
  'file',
  'email',
  'phone',
])
const allowedAttributes = new Set([
  'key',
  'type',
  'label',
  'required',
  'items',
  'description',
  'error_message',
  'max_file_count',
  'max_file_size',
  'placeholder',
  'min_length',
  'max_length',
])
const submittedAttributes = new Set(['key', 'type', 'label', 'value', 'items', 'required'])
const fail = (code: string, index?: number): Failure =>
  index === undefined ? { ok: false, code } : { ok: false, code, index }
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const identity = (v: Record<string, unknown>) => JSON.stringify([v.key, v.type, v.label])
const meaningful = (v: unknown) => v !== undefined && v !== null && v !== '' && v !== false
const optionKey = (v: unknown): string | null =>
  typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
    ? String(v)
    : null

export function planOpeningForm(sourceSnapshotRef: string, source: unknown): Plan {
  if (!sourceSnapshotRef.trim() || !Array.isArray(source)) return fail('INVALID_SOURCE')
  const mappings: Mapping[] = []
  const identities = new Set<string>()
  const keys = new Set<string>()
  for (const [index, entry] of source.entries()) {
    if (
      !object(entry) ||
      typeof entry.key !== 'string' ||
      !entry.key.trim() ||
      typeof entry.label !== 'string' ||
      !entry.label.trim() ||
      typeof entry.type !== 'string'
    )
      return fail('INVALID_FIELD', index)
    if (!supportedTypes.has(entry.type)) return fail('UNSUPPORTED_TYPE', index)
    if (
      entry.type === 'file' &&
      (typeof entry.max_file_count !== 'number' ||
        !Number.isInteger(entry.max_file_count) ||
        entry.max_file_count < 1 ||
        entry.max_file_count > MAX_FORM_FILES ||
        typeof entry.max_file_size !== 'number' ||
        !Number.isInteger(entry.max_file_size) ||
        entry.max_file_size < 1 ||
        entry.max_file_size > MAX_FORM_FILE_BYTES)
    )
      return fail('FILE_POLICY_REVIEW_REQUIRED', index)

    if ('other_option' in entry && typeof entry.other_option !== 'boolean')
      return fail('INVALID_OTHER_MARKER', index)
    if (entry.other_option === true) return fail('OTHER_OPTION_MAPPING_REQUIRED', index)
    if (Object.entries(entry).some(([k, v]) => !allowedAttributes.has(k) && meaningful(v)))
      return fail('UNSUPPORTED_ATTRIBUTE', index)
    if (entry.required !== undefined && typeof entry.required !== 'boolean')
      return fail('INVALID_FIELD', index)
    const id = identity(entry)
    const key = standardKeys.has(entry.key)
      ? entry.key
      : `custom_${createHash('sha256')
          .update(JSON.stringify([sourceSnapshotRef, id]))
          .digest('hex')
          .slice(0, 40)}`
    if (identities.has(id) || keys.has(key)) return fail('AMBIGUOUS_FIELD', index)
    identities.add(id)
    keys.add(key)
    const options = new Map<string, string>()
    if (entry.type === 'select' || entry.type === 'multiselect') {
      if (!Array.isArray(entry.items) || !entry.items.length) return fail('INVALID_OPTIONS', index)
      const labels = new Set<string>()
      for (const item of entry.items) {
        if (!object(item) || typeof item.label !== 'string' || !item.label.trim())
          return fail('INVALID_OPTIONS', index)
        const raw = optionKey(item.value)
        if (raw === null) return fail('INVALID_OPTIONS', index)
        if (
          raw === '' ||
          Object.entries(item).some(([k, v]) => !['label', 'value'].includes(k) && meaningful(v))
        )
          return fail('AMBIGUOUS_OPTIONS', index)
        if (options.has(raw) || labels.has(item.label)) return fail('AMBIGUOUS_OPTIONS', index)
        options.set(raw, item.label)
        labels.add(item.label)
      }
    } else if (entry.items != null && (!Array.isArray(entry.items) || entry.items.length > 0))
      return fail('UNSUPPORTED_ATTRIBUTE', index)
    // 표준 개인정보가 배열이 되는 폼은 기존 PII 추출기로 보존할 수 없다.
    if (
      standardKeys.has(key) &&
      ['select', 'multiselect', 'file', 'number', 'date'].includes(entry.type)
    )
      return fail('INVALID_PII_TYPE', index)
    const parsed = formFieldSchema.safeParse({
      key,
      type: entry.type,
      label: entry.label,
      required: entry.required ?? false,
      ...(entry.max_file_count != null ? { maxFileCount: entry.max_file_count } : {}),
      ...(entry.max_file_size != null ? { maxFileSize: entry.max_file_size } : {}),
      ...(entry.error_message != null ? { errorMessage: entry.error_message } : {}),
      ...(entry.description != null ? { description: entry.description } : {}),
      ...(entry.placeholder != null ? { placeholder: entry.placeholder } : {}),
      ...(entry.min_length != null ? { minLength: entry.min_length } : {}),
      ...(entry.max_length != null ? { maxLength: entry.max_length } : {}),
      ...(options.size ? { options: [...options.values()] } : {}),
    })
    if (!parsed.success) return fail('INVALID_TARGET_FIELD', index)
    mappings.push({ identity: id, field: parsed.data, options })
  }
  if (
    mappings
      .filter((m) => m.field.type === 'file')
      .reduce((sum, m) => sum + (m.field.maxFileCount ?? 1), 0) > MAX_FORM_FILES
  )
    return fail('FILE_POLICY_REVIEW_REQUIRED')
  const fields = mappings.map((m) => m.field)
  // 공개 폼이 보강하는 기본 항목까지 제출 API의 실제 한도로 검사한다.
  const effective = parseApplicationEntriesSchema(fields)
  if (
    !publicApplicationPayloadSchema.shape.entries.safeParse(
      effective.map((field) => ({ key: field.key, type: field.type, value: null }))
    ).success
  )
    return fail('FIELD_COUNT_LIMIT')
  return { ok: true, fields, mappings }
}

// 폼 이력 확인은 호출부의 책임이다. 현재 폼만으로 과거의 의미를 단정하지 않는다.
export function convertOpeningSubmission(
  plan: Plan,
  source: unknown,
  evidence: { sourceSnapshotVerified?: boolean }
): { ok: true; entries: ApplicationEntryValue[] } | Failure {
  if (!evidence.sourceSnapshotVerified) return fail('UNVERIFIED_SNAPSHOT')
  if (!plan.ok) return plan
  if (!Array.isArray(source)) return fail('INVALID_SUBMISSION')
  const entries: ApplicationEntryValue[] = []
  const seen = new Set<string>()
  for (const [index, entry] of source.entries()) {
    if (!object(entry)) return fail('INVALID_SUBMISSION', index)
    if ('is_other' in entry && typeof entry.is_other !== 'boolean')
      return fail('INVALID_OTHER_MARKER', index)
    // 원본은 선택지와 값의 엄격 비교로 계산한다. 자유입력의 확정 근거로 사용하지 않는다.
    if (entry.is_other === true) return fail('OTHER_RESPONSE_REVIEW_REQUIRED', index)
    if (Object.entries(entry).some(([k, v]) => !submittedAttributes.has(k) && meaningful(v)))
      return fail('UNSUPPORTED_ATTRIBUTE', index)
    const mapping = plan.mappings.find((m) => m.identity === identity(entry))
    if (!mapping) return fail('UNMATCHED_FIELD', index)
    const { field, options } = mapping
    if (seen.has(field.key)) return fail('DUPLICATE_SUBMISSION', index)
    seen.add(field.key)
    let value = entry.value ?? null
    if (Array.isArray(value) && !['multiselect', 'file'].includes(field.type))
      return fail('INVALID_VALUE', index)
    const empty = value === null || value === '' || (Array.isArray(value) && !value.length)
    if (empty) {
      if (field.required) return fail('MISSING_REQUIRED_FIELD', index)
    } else if (field.type === 'file') return fail('FILE_MAPPING_REQUIRED', index)
    else if (field.type === 'select' || field.type === 'multiselect') {
      if (field.type === 'multiselect' && !Array.isArray(value)) return fail('INVALID_VALUE', index)
      const values = field.type === 'multiselect' ? (value as unknown[]) : [value]
      const labels: string[] = []
      for (const raw of values) {
        const key = optionKey(raw)
        if (key === null || !options.has(key)) return fail('UNKNOWN_OPTION', index)
        labels.push(options.get(key)!)
      }
      value = field.type === 'multiselect' ? labels : labels[0]
    } else if (field.type === 'number' || field.type === 'date') {
      if (field.type === 'number' && typeof value === 'number') {
        if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
          return fail('INVALID_VALUE', index)
        value = String(value)
      }
      if (scalarFieldError(field.type, value, field)) return fail('INVALID_VALUE', index)
    } else if (scalarFieldError(field.type, value, field)) return fail('INVALID_VALUE', index)
    entries.push({ key: field.key, type: field.type, label: field.label, value })
  }
  if (plan.fields.some((f) => f.required && !seen.has(f.key))) return fail('MISSING_REQUIRED_FIELD')
  // 반환값에는 개인정보가 포함된다. 로그에 출력하지 말고 buildApplicationPii를 거쳐 저장한다.
  return { ok: true, entries }
}
