/**
 * 채용 Deck Storage 어댑터 — Supabase Storage 버킷 2종.
 * (선례: src/lib/supabase/storage.ts — sales-content)
 *
 * - `hiring-assets`  : 공고 이미지·Excalidraw export PNG. public-read.
 * - `hiring-files`   : 지원자 첨부(이력서 등). **비공개** — service-role 업로드 +
 *                      서명 URL 다운로드만 허용. getPublicUrl 사용 금지.
 *
 * 버킷은 Supabase 대시보드에서 수동 생성:
 *   hiring-assets  : public true,  file size limit 10 MB
 *   hiring-files   : public false, file size limit 10 MB
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

export const HIRING_ASSETS_BUCKET = 'hiring-assets'
export const HIRING_FILES_BUCKET = 'hiring-files'

// 업로드 용량 제한 (경로에서 사전 차단)
export const MAX_ASSET_BYTES = 10 * 1024 * 1024
export const MAX_APPLICANT_FILE_BYTES = 10 * 1024 * 1024

// 지원자 첨부 허용 MIME (공개 폼 남용 방어)
export const ALLOWED_APPLICANT_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/x-hwp',
  'application/haansofthwp',
])

let cached: SupabaseClient | null = null

function serviceClient(): SupabaseClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase 환경변수(service role)가 설정되지 않았습니다')
  cached = createClient(url, key, { auth: { persistSession: false } })
  return cached
}

export function extFromMime(mime: string): string {
  if (/png/i.test(mime)) return 'png'
  if (/jpeg|jpg/i.test(mime)) return 'jpg'
  if (/webp/i.test(mime)) return 'webp'
  if (/pdf/i.test(mime)) return 'pdf'
  if (/wordprocessingml/i.test(mime)) return 'docx'
  if (/msword/i.test(mime)) return 'doc'
  if (/spreadsheetml/i.test(mime)) return 'xlsx'
  if (/ms-excel/i.test(mime)) return 'xls'
  if (/hwp/i.test(mime)) return 'hwp'
  return 'bin'
}

// ─── hiring-assets (공고 이미지 — public) ─────────────────────────────────────

/** 공고 자산 업로드. 경로: {spaceId}/postings/{postingId}/{uuid}.{ext} */
export async function uploadPostingAsset(params: {
  spaceId: string
  postingId: string
  data: Buffer | Uint8Array
  mimeType: string
}): Promise<{ path: string; publicUrl: string }> {
  const { spaceId, postingId, data, mimeType } = params
  if (data.byteLength > MAX_ASSET_BYTES) throw new Error('파일이 용량 제한을 초과했습니다')
  const path = `${spaceId}/postings/${postingId}/${randomUUID()}.${extFromMime(mimeType)}`
  const sb = serviceClient()
  const { error } = await sb.storage
    .from(HIRING_ASSETS_BUCKET)
    .upload(path, data, { contentType: mimeType, upsert: false })
  if (error) throw new Error(`공고 자산 업로드 실패: ${error.message}`)
  const { data: pub } = sb.storage.from(HIRING_ASSETS_BUCKET).getPublicUrl(path)
  return { path, publicUrl: pub.publicUrl }
}

export function getPostingAssetPublicUrl(path: string): string {
  const { data } = serviceClient().storage.from(HIRING_ASSETS_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

// ─── hiring-files (지원자 첨부 — private) ────────────────────────────────────

/** 지원자 첨부 업로드(서버 경유). 경로: {spaceId}/applications/{applicationId}/{uuid}.{ext} */
export async function uploadApplicantFile(params: {
  spaceId: string
  applicationId: string
  data: Buffer | Uint8Array
  mimeType: string
}): Promise<{ path: string }> {
  const { spaceId, applicationId, data, mimeType } = params
  if (!ALLOWED_APPLICANT_MIME.has(mimeType)) throw new Error('허용되지 않는 파일 형식입니다')
  if (data.byteLength > MAX_APPLICANT_FILE_BYTES) throw new Error('파일이 용량 제한을 초과했습니다')
  const path = `${spaceId}/applications/${applicationId}/${randomUUID()}.${extFromMime(mimeType)}`
  const { error } = await serviceClient()
    .storage.from(HIRING_FILES_BUCKET)
    .upload(path, data, { contentType: mimeType, upsert: false })
  if (error) throw new Error(`지원자 파일 업로드 실패: ${error.message}`)
  return { path }
}

/** 지원자 첨부 서명 다운로드 URL (기본 10분) — 고용주 콘솔 전용 */
export async function getApplicantFileSignedUrl(path: string, expiresInSec = 600): Promise<string> {
  const { data, error } = await serviceClient()
    .storage.from(HIRING_FILES_BUCKET)
    .createSignedUrl(path, expiresInSec)
  if (error || !data) throw new Error(`서명 URL 생성 실패: ${error?.message}`)
  return data.signedUrl
}

/** 지원서 삭제 시 첨부 일괄 제거 */
export async function removeApplicantFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { error } = await serviceClient().storage.from(HIRING_FILES_BUCKET).remove(paths)
  if (error) throw new Error(`지원자 파일 삭제 실패: ${error.message}`)
}
