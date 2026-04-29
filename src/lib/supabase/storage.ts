// Sales Content Storage 어댑터 — Supabase Storage 의 `sales-content-assets` 버킷에
// 이미지·링크 에셋을 저장한다. 서버에서만 호출 (service role key 필요).
//
// DQ6: 버킷은 Supabase 대시보드에서 수동 생성해야 한다.
//   - 이름: sales-content-assets
//   - public: true (public-read)
//   - file size limit: 20 MB 권장
// 버킷이 없으면 첫 업로드 시 "Bucket not found" 에러가 난다.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

export const SALES_CONTENT_BUCKET = 'sales-content-assets'

// 용량 제한 (업로드 경로에서 사전 차단)
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

let cached: SupabaseClient | null = null

function serviceClient(): SupabaseClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase 환경변수가 설정되지 않았습니다')
  cached = createClient(url, key, { auth: { persistSession: false } })
  return cached
}

export function extFromMime(mime: string): string {
  if (/png/i.test(mime)) return 'png'
  if (/jpeg|jpg/i.test(mime)) return 'jpg'
  if (/webp/i.test(mime)) return 'webp'
  if (/gif/i.test(mime)) return 'gif'
  return 'bin'
}

// 저장 경로: {spaceId}/content/{contentId}/{uuid}.{ext}
export function buildStoragePath(params: {
  spaceId: string
  contentId: string
  mimeType: string
}): string {
  const ext = extFromMime(params.mimeType)
  return `${params.spaceId}/content/${params.contentId}/${randomUUID()}.${ext}`
}

export interface UploadedAsset {
  storagePath: string
  publicUrl: string
  size: number
  mimeType: string
}

// 원본 바이트를 버킷에 저장하고 public URL 을 돌려준다.
export async function uploadAssetBytes(params: {
  spaceId: string
  contentId: string
  bytes: Buffer
  mimeType: string
}): Promise<UploadedAsset> {
  if (params.bytes.length > MAX_UPLOAD_BYTES) {
    throw new UploadTooLargeError(params.bytes.length, MAX_UPLOAD_BYTES)
  }
  const client = serviceClient()
  const path = buildStoragePath({
    spaceId: params.spaceId,
    contentId: params.contentId,
    mimeType: params.mimeType,
  })

  const { error } = await client.storage.from(SALES_CONTENT_BUCKET).upload(path, params.bytes, {
    contentType: params.mimeType,
    upsert: false,
  })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data } = client.storage.from(SALES_CONTENT_BUCKET).getPublicUrl(path)

  return {
    storagePath: path,
    publicUrl: data.publicUrl,
    size: params.bytes.length,
    mimeType: params.mimeType,
  }
}

export async function deleteAsset(storagePath: string): Promise<void> {
  const client = serviceClient()
  const { error } = await client.storage.from(SALES_CONTENT_BUCKET).remove([storagePath])
  if (error) throw new Error(`Storage delete failed: ${error.message}`)
}

export class UploadTooLargeError extends Error {
  readonly code = 'UPLOAD_TOO_LARGE' as const
  constructor(
    public readonly size: number,
    public readonly limit: number
  ) {
    super(`업로드 크기 ${size}B 는 최대 ${limit}B 를 초과합니다`)
  }
}
