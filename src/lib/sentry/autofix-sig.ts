import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

// 환경변수 SENTRY_AUTOFIX_NOTE_SECRET(32자 이상): 앱과 맥미니 러너만 아는 ready/approve 노트 서명 키. 없으면 fail closed.
export type NoteKind = 'ready' | 'approve'

const secret = () => {
  const s = process.env.SENTRY_AUTOFIX_NOTE_SECRET
  return s && s.length >= 32 ? s : null
}

export const isNoteSigConfigured = () => secret() !== null

function compute(key: string, kind: NoteKind, issueId: string, id: string, sha: string) {
  return createHmac('sha256', key)
    .update(`${kind}|${issueId}|${id}|${sha}`)
    .digest('hex')
    .slice(0, 32)
}

export function noteSig(kind: NoteKind, issueId: string, id: string, sha: string): string {
  const key = secret()
  if (!key) throw new Error('SENTRY_AUTOFIX_NOTE_SECRET 미설정')
  return compute(key, kind, issueId, id, sha)
}

export function verifyNoteSig(
  kind: NoteKind,
  issueId: string,
  id: string,
  sha: string,
  sig: string | undefined
): boolean {
  const key = secret()
  if (!key || !sig) return false
  const a = Buffer.from(sig)
  const b = Buffer.from(compute(key, kind, issueId, id, sha))
  return a.length === b.length && timingSafeEqual(a, b)
}
