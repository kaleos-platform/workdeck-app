export const MAX_FORM_FILES = 3
export const MAX_FORM_FILE_BYTES = 20 * 1024 * 1024
export type FileField = {
  key: string
  type: string
  required?: boolean
  maxFileCount?: number
  maxFileSize?: number
}
export function validFileLimits(field: {
  type: string
  maxFileCount?: number
  maxFileSize?: number
}): boolean {
  return (
    field.type === 'file' || (field.maxFileCount === undefined && field.maxFileSize === undefined)
  )
}

// 파일 순서와 별도로 전달한 항목 key를 공고 정의와 대조한다.
export function fileFieldError(
  fields: FileField[],
  keys: string[],
  fileCount: number,
  sizes?: number[]
): string | null {
  if (keys.length !== fileCount)
    return '첨부 연결 정보가 변경되었습니다. 새로고침 후 다시 제출하세요'
  const fileFields = fields.filter((field) => field.type === 'file')
  if (fileCount > MAX_FORM_FILES) return `첨부는 전체 ${MAX_FORM_FILES}개까지 가능합니다`
  for (const field of fileFields) {
    if (keys.filter((key) => key === field.key).length > (field.maxFileCount ?? 1))
      return `항목당 첨부는 ${field.maxFileCount ?? 1}개까지 가능합니다`
  }
  if (
    sizes &&
    (sizes.length !== fileCount ||
      sizes.some((size, index) => {
        const field = fileFields.find((field) => field.key === keys[index])
        return (
          !Number.isSafeInteger(size) ||
          size <= 0 ||
          size > Math.min(field?.maxFileSize ?? MAX_FORM_FILE_BYTES, MAX_FORM_FILE_BYTES)
        )
      }))
  )
    return '빈 파일이거나 파일 용량 제한을 초과했습니다'
  if (keys.some((key) => !fileFields.some((field) => field.key === key)))
    return '공고에 없는 첨부 항목입니다'
  if (fileFields.some((field) => field.required && !keys.includes(field.key)))
    return '필수 첨부 파일을 선택하세요'
  return null
}

// 기존 첨부나 모호한 JSON 연결은 파일명으로 추정하지 않는다.
export function fileFieldLabel(entries: unknown, fileId: string): string | undefined {
  if (!Array.isArray(entries)) return undefined
  const matched = entries.filter(
    (entry) =>
      entry &&
      entry.type === 'file' &&
      Array.isArray(entry.fileIds) &&
      entry.fileIds.includes(fileId)
  )
  if (matched.length !== 1) return undefined
  return typeof matched[0].label === 'string' && matched[0].label.trim()
    ? matched[0].label
    : undefined
}

export function fileLimitText(field: { maxFileCount?: number; maxFileSize?: number }): string {
  const bytes = field.maxFileSize ?? MAX_FORM_FILE_BYTES
  const size =
    bytes >= 1024 * 1024 ? `${bytes / (1024 * 1024)} MiB` : `${bytes.toLocaleString('ko-KR')} bytes`
  return `최대 ${field.maxFileCount ?? 1}개 · 파일당 ${size} · 전체 ${MAX_FORM_FILES}개까지`
}
