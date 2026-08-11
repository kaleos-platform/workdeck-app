/**
 * Supabase service-role 클라이언트 — 웹 어드민 전용 (auth.admin API: ban/삭제/MFA 조회 등).
 * (선례: src/lib/hiring/storage.ts:39 serviceClient)
 *
 * 서버 전용 — 클라이언트 번들에 절대 포함되면 안 됨.
 */
import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function getSupabaseAdminClient(): SupabaseClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase 환경변수(service role)가 설정되지 않았습니다')
  cached = createClient(url, key, { auth: { persistSession: false } })
  return cached
}
