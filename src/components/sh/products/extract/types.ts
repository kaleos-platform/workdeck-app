// AI 상품정보 추출 UI 공용 타입 — API JSON 응답 shape과 1:1로 대응한다.
// prisma 타입을 클라이언트 컴포넌트가 직접 import하지 않는 기존 관례를 따라 로컬로 재정의한다.

export type ExtractSourceKind = 'URL' | 'TEXT' | 'IMAGE' | 'PDF'
export type ExtractJobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'

/** src/lib/sh/product-extract.ts의 ExtractedProductInfo와 동일한 shape */
export type ExtractedProductInfo = {
  description: string | null
  features: string[]
  certifications: string[]
  ingredients: string[]
  capacity: string | null
  originCountry: string | null
  manufacturer: string | null
  cautions: string[]
  confidence: number
  notes: string | null
  truncatedFields: string[]
}

export type ExtractSource = {
  id: string
  kind: ExtractSourceKind
  url: string | null
  finalUrl: string | null
  storagePath: string | null
  fileName: string | null
  mimeType: string | null
  byteSize: number | null
  textContent: string | null
  /** GET /extract/{jobId} 상세 조회에서만 포함됨(600초 유효 서명 URL) */
  signedUrl?: string | null
  createdAt: string
}

export type ExtractJob = {
  id: string
  status: ExtractJobStatus
  provider: string
  model: string
  result: ExtractedProductInfo | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  errorCode: string | null
  errorMessage: string | null
  appliedAt: string | null
  appliedFields: string[] | null
  rolledBackAt: string | null
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
  sources: ExtractSource[]
}

export type UploadedSourceFile = {
  storagePath: string
  fileName: string
  mimeType: string
  byteSize: number
  kind: 'IMAGE' | 'PDF'
}

export type ApplyField =
  | 'description'
  | 'features'
  | 'certifications'
  | 'manufacturer'
  | 'manufactureCountry'
