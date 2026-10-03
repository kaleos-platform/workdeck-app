import { z } from 'zod'
import { parseYmdDateKst } from '@/lib/date-range'

// 값은 문자열로 유지해 숫자의 표기와 날짜를 timezone 변환 없이 보존한다.
export function scalarFieldError(
  type: string,
  value: unknown,
  limits: { minLength?: number; maxLength?: number; errorMessage?: string } = {}
): string | null {
  if (typeof value !== 'string') return '입력 형식이 올바르지 않습니다'
  if (value === '') return null
  if (type === 'email' && !z.string().email().safeParse(value).success)
    return '이메일 형식이 올바르지 않습니다'
  if (
    type === 'phone' &&
    (!/^\+?[\d\s()-]+$/.test(value) || !/^\d{7,15}$/.test(value.replace(/\D/g, '')))
  )
    return '연락처 형식이 올바르지 않습니다'
  if (
    type === 'number' &&
    (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ||
      !Number.isFinite(Number(value)))
  )
    return '올바른 숫자를 입력하세요'
  if (type === 'date' && !parseYmdDateKst(value)) return '올바른 날짜를 입력하세요'
  if (limits.minLength && value.length < limits.minLength)
    return limits.errorMessage?.trim()
      ? limits.errorMessage
      : `최소 ${limits.minLength}자 이상 입력하세요`
  if (limits.maxLength && value.length > limits.maxLength)
    return limits.errorMessage?.trim()
      ? limits.errorMessage
      : `최대 ${limits.maxLength}자까지 입력하세요`
  return null
}

export function typedSubmissionError(
  fields: Array<{
    key: string
    type: string
    required?: boolean
    errorMessage?: string
    minLength?: number
    maxLength?: number
    options?: string[]
  }>,
  entries: Array<{ key: string; type: string; value: unknown }>
): string | null {
  if (entries.some((entry) => !fields.some((field) => field.key === entry.key)))
    return '공고에 없는 지원서 항목입니다'
  for (const field of fields) {
    const matched = entries.filter((entry) => entry.key === field.key)
    if (matched.length > 1) return '중복된 지원서 항목입니다'
    const entry = matched[0]
    if (entry && entry.type !== field.type)
      return '지원서 항목 형식이 변경되었습니다. 새로고침 후 다시 제출하세요'
    // 첨부의 필수 여부와 내용은 실제 multipart 파일로 별도 검증한다.
    if (field.type === 'file') continue
    if (
      !entry ||
      entry.value === null ||
      (typeof entry.value === 'string' && !entry.value.trim()) ||
      (Array.isArray(entry.value) && !entry.value.length)
    ) {
      if (field.required) return '필수 항목을 입력하세요'
      continue
    }
    if (field.type === 'select' || field.type === 'multiselect') {
      if (
        field.type === 'multiselect' ? !Array.isArray(entry.value) : typeof entry.value !== 'string'
      )
        return '선택값 형식이 올바르지 않습니다'
      const values = Array.isArray(entry.value) ? entry.value : [entry.value]
      if (
        new Set(values).size !== values.length ||
        values.some((value) => typeof value !== 'string' || !field.options?.includes(value))
      )
        return '선택지에 없는 값이거나 중복된 선택입니다'
      continue
    }
    const error = scalarFieldError(field.type, entry.value, field)
    if (error) return error
  }
  return null
}

// 길이 0은 구 서비스와 동일하게 제한 없음으로 취급한다.
export function validFieldLengths(field: {
  type: string
  minLength?: number
  maxLength?: number
}): boolean {
  if (!field.minLength && !field.maxLength) return true
  if (['select', 'multiselect', 'file'].includes(field.type)) return false
  return !field.minLength || !field.maxLength || field.minLength <= field.maxLength
}

// 사용자가 유형을 직접 변경할 때만 호출한다. 원본 이전 검증에는 사용하지 않는다.
export function clearIncompatibleFieldLimits<
  T extends {
    type: string
    minLength?: number
    maxLength?: number
    maxFileCount?: number
    maxFileSize?: number
  },
>(field: T): T {
  const next = { ...field }
  if (next.type !== 'file') {
    delete next.maxFileCount
    delete next.maxFileSize
  }
  if (['select', 'multiselect', 'file'].includes(next.type)) {
    delete next.minLength
    delete next.maxLength
  }
  return next
}
