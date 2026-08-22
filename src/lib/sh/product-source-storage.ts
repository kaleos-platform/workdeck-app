/**
 * 상품 자동 설명 생성 — 소재 파일(Source) Storage 어댑터.
 * (선례: src/lib/hiring/storage.ts 의 hiring-files 비공개 버킷 패턴)
 *
 * `product-source-files` : 상품 설명 추출용 사용자 첨부(이미지·PDF). **비공개** —
 *   service-role 업로드 + 서명 URL 다운로드만 허용. getPublicUrl 사용 금지.
 *   (인증서 등 민감 파일이 포함될 수 있음 — 절대 공개 버킷으로 전환하지 말 것)
 *
 * 버킷은 Supabase 대시보드에서 수동 생성:
 *   product-source-files : public false, file size limit 10 MB
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

export const PRODUCT_SOURCE_BUCKET = 'product-source-files'

// 파일당 10MB, Job 합계는 12MB(Gemini inline 한도 대비 마진)로 별도 제한
export const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024
export const MAX_JOB_INLINE_BYTES = 12 * 1024 * 1024
export const MAX_SOURCE_FILES = 5

export const ALLOWED_SOURCE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const
export type ProductSourceMimeType = (typeof ALLOWED_SOURCE_MIME_TYPES)[number]

function isAllowedMime(mime: string): mime is ProductSourceMimeType {
  return (ALLOWED_SOURCE_MIME_TYPES as readonly string[]).includes(mime)
}

export type ProductSourceUploadErrorCode =
  | 'TOO_LARGE'
  | 'MIME_NOT_ALLOWED'
  | 'UPLOAD_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'DELETE_FAILED'

export class ProductSourceUploadError extends Error {
  readonly code: ProductSourceUploadErrorCode
  constructor(code: ProductSourceUploadErrorCode, message: string) {
    super(message)
    this.name = 'ProductSourceUploadError'
    this.code = code
  }
}

let cached: SupabaseClient | null = null

function serviceClient(): SupabaseClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase 환경변수(service role)가 설정되지 않았습니다')
  cached = createClient(url, key, { auth: { persistSession: false } })
  return cached
}

function extFromMime(mime: string): string {
  if (/png/i.test(mime)) return 'png'
  if (/jpeg|jpg/i.test(mime)) return 'jpg'
  if (/webp/i.test(mime)) return 'webp'
  if (/pdf/i.test(mime)) return 'pdf'
  return 'bin'
}

/**
 * 소재 파일 업로드. 경로: {spaceId}/products/{productId}/{uuid}.{ext}
 * jobId는 경로에 포함하지 않는다 — 업로드가 Job 생성보다 먼저 일어나기 때문.
 */
export async function uploadProductSourceFile(input: {
  spaceId: string
  productId: string
  fileName: string
  mimeType: string
  bytes: Buffer
}): Promise<{
  storagePath: string
  fileName: string
  mimeType: ProductSourceMimeType
  byteSize: number
}> {
  const { spaceId, productId, fileName, mimeType, bytes } = input

  if (!isAllowedMime(mimeType)) {
    throw new ProductSourceUploadError(
      'MIME_NOT_ALLOWED',
      `허용되지 않는 파일 형식입니다: ${mimeType}`
    )
  }
  if (bytes.byteLength > MAX_SOURCE_FILE_BYTES) {
    throw new ProductSourceUploadError('TOO_LARGE', '파일이 용량 제한(10MB)을 초과했습니다')
  }

  const storagePath = `${spaceId}/products/${productId}/${randomUUID()}.${extFromMime(mimeType)}`
  const { error } = await serviceClient()
    .storage.from(PRODUCT_SOURCE_BUCKET)
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false })
  if (error) {
    throw new ProductSourceUploadError('UPLOAD_FAILED', `소재 파일 업로드 실패: ${error.message}`)
  }

  return { storagePath, fileName, mimeType, byteSize: bytes.byteLength }
}

/** 소재 파일 다운로드 — Gemini 추출 호출 시 inline 데이터로 사용 */
export async function downloadProductSourceFile(storagePath: string): Promise<Buffer> {
  const { data, error } = await serviceClient()
    .storage.from(PRODUCT_SOURCE_BUCKET)
    .download(storagePath)
  if (error || !data) {
    throw new ProductSourceUploadError(
      'DOWNLOAD_FAILED',
      `소재 파일 다운로드 실패: ${error?.message}`
    )
  }
  const arrayBuffer = await data.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/** 소재 파일 서명 다운로드 URL (기본 10분) — 콘솔 미리보기 전용 */
export async function getProductSourceSignedUrl(
  storagePath: string,
  expiresInSec = 600
): Promise<string> {
  const { data, error } = await serviceClient()
    .storage.from(PRODUCT_SOURCE_BUCKET)
    .createSignedUrl(storagePath, expiresInSec)
  if (error || !data) {
    throw new ProductSourceUploadError('DOWNLOAD_FAILED', `서명 URL 생성 실패: ${error?.message}`)
  }
  return data.signedUrl
}

/** Job/소재 삭제 시 파일 일괄 제거 */
export async function removeProductSourceFiles(storagePaths: string[]): Promise<void> {
  if (storagePaths.length === 0) return
  const { error } = await serviceClient().storage.from(PRODUCT_SOURCE_BUCKET).remove(storagePaths)
  if (error)
    throw new ProductSourceUploadError('UPLOAD_FAILED', `소재 파일 삭제 실패: ${error.message}`)
}

/**
 * storagePath가 실제로 해당 space/product 소유인지 검증한다.
 * 다른 Space가 남의 파일 경로를 참조하지 못하게 막는 가드 — 순수 함수라 단독 테스트 가능.
 * 접두사 일치 + `..` 경로 탈출 시도 차단을 모두 확인한다.
 */
export function isOwnedSourcePath(
  storagePath: string,
  spaceId: string,
  productId: string
): boolean {
  if (storagePath.split('/').some((segment) => segment === '..')) return false
  const prefix = `${spaceId}/products/${productId}/`
  return storagePath.startsWith(prefix)
}
