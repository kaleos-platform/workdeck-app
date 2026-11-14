import { createClient } from '@supabase/supabase-js'
import { HIRING_FILES_BUCKET } from './storage'

const STORAGE_TIMEOUT_MS = 3_000

export function cleanupFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(STORAGE_TIMEOUT_MS)
  const originalSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  const signal = originalSignal ? AbortSignal.any([originalSignal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

export async function removeCleanupFiles(paths: string[]): Promise<void> {
  if (!paths.length) return
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw Error('cleanup storage unavailable')
  const client = createClient(url, key, { auth: { persistSession: false }, global: { fetch: cleanupFetch } })
  const { error } = await client.storage.from(HIRING_FILES_BUCKET).remove(paths)
  if (error) throw Error('cleanup storage unavailable')
}
