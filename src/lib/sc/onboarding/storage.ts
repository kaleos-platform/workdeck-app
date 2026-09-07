// 세일즈 콘텐츠 온보딩 Storage 어댑터 — Supabase Storage 버킷 2종 사용.
// (선례: src/lib/hiring/storage.ts — hiring-files private 패턴)
//
// - `sales-content-files`  : 온보딩 문서(회사소개서 등). **비공개** — service-role 업로드 +
//                            서명 URL 다운로드만 허용. getPublicUrl 사용 금지.
// - `sales-content-assets` : 브랜드 로고(public-read, 기존 버킷 재사용).
//
// 버킷은 Supabase 대시보드에서 수동 생성:
//   sales-content-files : public false, file size limit 10 MB
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { SALES_CONTENT_BUCKET } from '@/lib/supabase/storage'

export const SC_FILES_BUCKET = 'sales-content-files'

export const MAX_RESOURCE_FILE_BYTES = 10 * 1024 * 1024
export const MAX_LOGO_BYTES = 2 * 1024 * 1024

// 온보딩 문서 허용 MIME
export const ALLOWED_RESOURCE_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-hwp',
  'application/haansofthwp',
  'text/plain',
])

export const ALLOWED_LOGO_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

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
  if (/pdf/i.test(mime)) return 'pdf'
  if (/wordprocessingml/i.test(mime)) return 'docx'
  if (/msword/i.test(mime)) return 'doc'
  if (/presentationml/i.test(mime)) return 'pptx'
  if (/ms-powerpoint/i.test(mime)) return 'ppt'
  if (/hwp/i.test(mime)) return 'hwp'
  if (/plain/i.test(mime)) return 'txt'
  if (/png/i.test(mime)) return 'png'
  if (/jpeg|jpg/i.test(mime)) return 'jpg'
  if (/webp/i.test(mime)) return 'webp'
  if (/svg/i.test(mime)) return 'svg'
  return 'bin'
}

// ─── sales-content-files (온보딩 문서 — private) ─────────────────────────────

/** 온보딩 문서 업로드. 경로: {spaceId}/onboarding/{uuid}.{ext} */
export async function uploadOnboardingFile(params: {
  spaceId: string
  data: Buffer | Uint8Array
  mimeType: string
}): Promise<{ path: string }> {
  const { spaceId, data, mimeType } = params
  if (!ALLOWED_RESOURCE_MIME.has(mimeType)) throw new Error('허용되지 않는 파일 형식입니다')
  if (data.byteLength > MAX_RESOURCE_FILE_BYTES) throw new Error('파일이 용량 제한(10MB)을 초과했습니다')
  const path = `${spaceId}/onboarding/${randomUUID()}.${extFromMime(mimeType)}`
  const { error } = await serviceClient()
    .storage.from(SC_FILES_BUCKET)
    .upload(path, data, { contentType: mimeType, upsert: false })
  if (error) throw new Error(`온보딩 파일 업로드 실패: ${error.message}`)
  return { path }
}

/** 온보딩 문서 서명 다운로드 URL (기본 10분) */
export async function getOnboardingFileSignedUrl(path: string, expiresInSec = 600): Promise<string> {
  const { data, error } = await serviceClient()
    .storage.from(SC_FILES_BUCKET)
    .createSignedUrl(path, expiresInSec)
  if (error || !data) throw new Error(`서명 URL 생성 실패: ${error?.message}`)
  return data.signedUrl
}

/** 리소스 삭제 시 파일 제거 */
export async function removeOnboardingFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { error } = await serviceClient().storage.from(SC_FILES_BUCKET).remove(paths)
  if (error) throw new Error(`온보딩 파일 삭제 실패: ${error.message}`)
}

// ─── sales-content-assets (브랜드 로고 — public, 기존 버킷) ───────────────────

/** 브랜드 로고 업로드. 경로: {spaceId}/brand/logo-{uuid}.{ext} — 재업로드 시 새 경로 */
export async function uploadBrandLogo(params: {
  spaceId: string
  data: Buffer | Uint8Array
  mimeType: string
}): Promise<{ path: string; publicUrl: string }> {
  const { spaceId, data, mimeType } = params
  if (!ALLOWED_LOGO_MIME.has(mimeType)) throw new Error('허용되지 않는 이미지 형식입니다')
  if (data.byteLength > MAX_LOGO_BYTES) throw new Error('로고가 용량 제한(2MB)을 초과했습니다')
  const path = `${spaceId}/brand/logo-${randomUUID()}.${extFromMime(mimeType)}`
  const sb = serviceClient()
  const { error } = await sb.storage
    .from(SALES_CONTENT_BUCKET)
    .upload(path, data, { contentType: mimeType, upsert: false })
  if (error) throw new Error(`로고 업로드 실패: ${error.message}`)
  const { data: pub } = sb.storage.from(SALES_CONTENT_BUCKET).getPublicUrl(path)
  return { path, publicUrl: pub.publicUrl }
}
