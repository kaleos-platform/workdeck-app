import 'server-only'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { MAX_FILE_BYTES } from '@/lib/feedback/policy'

/** 비공개 버킷(public false, file size limit 1 MiB) — Supabase 대시보드에서 수동 생성. 이미지 변환(transform) 사용 금지. */
export const FEEDBACK_FILES_BUCKET = 'feedback-files'

const serviceClient = getSupabaseAdminClient
const bucket = () => serviceClient().storage.from(FEEDBACK_FILES_BUCKET)

let bucketOk = false
/** 버킷이 비공개·≤1 MiB가 아니면 throw(업로드·서명 모두 fail closed). 성공은 프로세스당 1회 캐시. */
export async function assertFeedbackBucket(): Promise<void> {
  if (bucketOk) return
  const { data, error } = await serviceClient().storage.getBucket(FEEDBACK_FILES_BUCKET)
  if (
    error ||
    !data ||
    data.public !== false ||
    !data.file_size_limit ||
    data.file_size_limit > MAX_FILE_BYTES
  )
    throw new Error('의견 첨부 버킷 설정(비공개·1 MiB 이하)을 확인하세요')
  bucketOk = true
}

export async function uploadFeedbackFile(
  path: string,
  data: Uint8Array,
  mime: string
): Promise<void> {
  const { error } = await bucket().upload(path, data, { contentType: mime, upsert: false })
  if (error) throw new Error(`의견 첨부 업로드 실패: ${error.message}`)
}

/** 멱등 — 없는 경로는 removed로 취급. Supabase가 돌려준 목록에 없어도 오류가 없으면 성공. */
export async function removeFeedbackFiles(
  paths: string[]
): Promise<{ removed: string[]; failed: string[] }> {
  if (paths.length === 0) return { removed: [], failed: [] }
  const { error } = await bucket().remove(paths)
  return error ? { removed: [], failed: paths } : { removed: paths, failed: [] }
}

/** 호출 전에 assertFeedbackBucket()을 한 번 거칠 것(fail closed). */
export async function signFeedbackFile(path: string, seconds = 600): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(path, seconds)
  if (error || !data) throw new Error(`서명 URL 생성 실패: ${error?.message}`)
  return data.signedUrl
}
