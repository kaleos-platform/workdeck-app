// Sentry 이슈 노트(`autofix:` 접두)로 자동 수정 상태를 표현한다. Phase 3 러너도 같은 형식으로 쓴다.
export type AutofixKind = 'none' | 'request' | 'running' | 'pr' | 'analysis' | 'failed' | 'skip'

export type AutofixState = {
  kind: AutofixKind
  at?: string
  prUrl?: string
  until?: string
  reason?: string
}

const PR_URL = /^https:\/\/github\.com\/kaleos-platform\/[\w.-]+\/pull\/\d+$/
const KNOWN = /^autofix:(request|running|pr|analysis|failed|skip)(\s|$)/

export function parseAutofixState(comments: { text: string; dateCreated: string }[]): AutofixState {
  const latest = comments
    .filter((c) => KNOWN.test(c.text.trim()))
    .sort((a, b) => Date.parse(b.dateCreated) - Date.parse(a.dateCreated))[0]
  if (!latest) return { kind: 'none' }

  const [head, ...rest] = latest.text.trim().split('\n')[0].slice('autofix:'.length).split(/\s+/)
  const arg = rest.join(' ')
  const at = latest.dateCreated
  switch (head) {
    case 'request':
    case 'analysis':
    case 'skip':
      return { kind: head, at }
    case 'running': {
      const until = arg.match(/until=(\S+)/)?.[1]
      return { kind: 'running', at, until }
    }
    case 'pr':
      return { kind: 'pr', at, prUrl: PR_URL.test(rest[0] ?? '') ? rest[0] : undefined }
    case 'failed':
      return { kind: 'failed', at, reason: arg || undefined }
    default:
      return { kind: 'none' }
  }
}

export function shouldWriteNote(current: AutofixState, next: 'request' | 'skip'): boolean {
  return current.kind !== next
}
