/** 컬럼 검증 실패 시 에러 응답 */
export type UploadColumnError = {
  message: string
  missingColumns: string[]
  foundColumns: string[]
}

/** 중복 데이터 감지 — 사용자 확인 대기 */
export type UploadDuplicateConfirmation = {
  requiresConfirmation: true
  duplicateCount: number
  newCount: number
  totalCount: number
}

/** 업로드 성공 응답 */
export type UploadSuccess = {
  uploadId: string
  inserted: number
  skipped: number
  errors: unknown[]
}

export type UploadResponse = UploadDuplicateConfirmation | UploadSuccess
