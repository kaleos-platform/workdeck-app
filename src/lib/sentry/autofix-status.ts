// Sentry 이슈 노트(`autofix:` 접두)로 자동 수정 상태를 표현한다. Phase 3 러너도 같은 형식으로 쓴다.
export type AutofixKind =
  | 'none'
  | 'request'
  | 'running'
  | 'pr'
  | 'analysis'
  | 'failed'
  | 'skip'
  | 'ready'
  | 'approve'

export type AutofixState = {
  kind: AutofixKind
  at?: string
  prUrl?: string
  until?: string
  reason?: string
  // ready · approve 메모
  id?: string
  sha?: string
  files?: number
  lines?: number
  verify?: 'ok' | 'fail'
  review?: 'approve' | 'blocking'
  by?: 'admin' | 'slack'
  // 서명(sig=)은 서버(api.ts listComments)에서만 검증한다 — 이 파일은 클라이언트에서도 쓰이므로 crypto 없음
}

const PR_URL = /^https:\/\/github\.com\/kaleos-platform\/[\w.-]+\/pull\/\d+$/
const KNOWN = /^autofix:(request|running|pr|analysis|failed|skip|ready|approve)(\s|$)/

const PENDING_ID = /^\d{8}-\d{6}-[0-9a-f]{4}-[A-Za-z0-9-]{3,40}$/
const SHA = /^[0-9a-f]{16}$/

type Comment = { text: string; dateCreated: string }

// 첫 줄의 key=value 쌍
function kv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of text
    .trim()
    .split('\n')[0]
    .matchAll(/(\w+)=(\S+)/g))
    out[m[1]] = m[2]
  return out
}

// ready · approve 는 id·sha 가 올바를 때만 유효 — 아니면 없는 노트로 본다
function isValid(text: string): boolean {
  const t = text.trim()
  if (!KNOWN.test(t)) return false
  if (!/^autofix:(ready|approve)(\s|$)/.test(t)) return true
  const { id, sha } = kv(t)
  return PENDING_ID.test(id ?? '') && SHA.test(sha ?? '')
}

export function parseAutofixState(comments: Comment[]): AutofixState {
  const latest = comments
    .filter((c) => isValid(c.text))
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
    case 'ready': {
      const f = kv(latest.text)
      return {
        kind: 'ready',
        at,
        id: f.id,
        sha: f.sha,
        files: Number(f.files) || 0,
        lines: Number(f.lines) || 0,
        verify: f.verify === 'ok' ? 'ok' : 'fail',
        review: f.review === 'approve' ? 'approve' : 'blocking',
      }
    }
    case 'approve': {
      const f = kv(latest.text)
      return { kind: 'approve', at, id: f.id, sha: f.sha, by: f.by === 'slack' ? 'slack' : 'admin' }
    }
    case 'failed':
      return { kind: 'failed', at, reason: arg || undefined }
    default:
      return { kind: 'none' }
  }
}

export function shouldWriteNote(current: AutofixState, next: 'request' | 'skip'): boolean {
  return current.kind !== next
}

// 검증 통과·리뷰 승인된 ready 만 승인 가능
export const isApprovable = (s: AutofixState) =>
  s.kind === 'ready' && s.verify === 'ok' && s.review === 'approve'

// 승인은 최신 ready 의 id·sha 와 정확히 일치하고 검증·리뷰가 통과일 때만
export function canApprove(state: AutofixState, id: string, sha: string): boolean {
  return isApprovable(state) && state.id === id && state.sha === sha
}

export type Triage = {
  p: 'P1' | 'P2' | 'P3'
  cat: 'user-block' | 'data-loss' | 'integration' | 'degraded' | 'noise'
  act: 'fix' | 'confirm' | 'ignore'
  at: string
}

const TRIAGE =
  /^autofix:triage p=(P[123]) cat=(user-block|data-loss|integration|degraded|noise) act=(fix|confirm|ignore)$/

export function parseTriage(comments: Comment[]): Triage | null {
  let best: Triage | null = null
  for (const c of comments) {
    const m = c.text.trim().split('\n')[0].trim().match(TRIAGE)
    if (!m) continue
    if (best && Date.parse(c.dateCreated) <= Date.parse(best.at)) continue
    best = {
      p: m[1] as Triage['p'],
      cat: m[2] as Triage['cat'],
      act: m[3] as Triage['act'],
      at: c.dateCreated,
    }
  }
  return best
}

export type Stage =
  | 'unjudged'
  | 'fix-planned'
  | 'confirm'
  | 'ignore-suggested'
  | 'approval'
  | 'approved'
  | 'requested'
  | 'running'
  | 'pr'
  | 'analysis'
  | 'failed'
  | 'skipped'

export const STAGE_LABELS: Record<Stage, string> = {
  unjudged: '판단 전',
  'fix-planned': '수정 예정',
  confirm: '확인 필요',
  'ignore-suggested': '제외 제안',
  approval: '승인 대기',
  approved: '승인됨',
  requested: '요청됨',
  running: '진행 중',
  pr: 'PR',
  analysis: '분석만',
  failed: '실패',
  skipped: '제외',
}

const BY_KIND: Partial<Record<AutofixKind, Stage>> = {
  ready: 'approval',
  approve: 'approved',
  request: 'requested',
  running: 'running',
  pr: 'pr',
  analysis: 'analysis',
  failed: 'failed',
  skip: 'skipped',
}
const BY_ACT: Record<Triage['act'], Stage> = {
  fix: 'fix-planned',
  confirm: 'confirm',
  ignore: 'ignore-suggested',
}

export function deriveStage(state: AutofixState, triage: Triage | null): Stage {
  return BY_KIND[state.kind] ?? (triage ? BY_ACT[triage.act] : 'unjudged')
}

export const CATEGORY_LABELS: Record<Triage['cat'], string> = {
  'user-block': '사용자 차단',
  'data-loss': '데이터 누락',
  integration: '외부 연동',
  degraded: '기능 저하',
  noise: '노이즈',
}

// AI 자유 문장은 쓰지 않고 코드와 수치로만 근거를 만든다
export function triageReason(
  triage: Triage,
  row: { count: number; userCount: number; firstSeen: string },
  now: number = Date.now()
): string {
  const days = Math.max(1, Math.ceil((now - Date.parse(row.firstSeen)) / 86_400_000) || 1)
  const parts = [CATEGORY_LABELS[triage.cat], `${days}일간 ${row.count}회`]
  if (row.userCount > 0) parts.push(`사용자 ${row.userCount}명`)
  return parts.join(' · ')
}
