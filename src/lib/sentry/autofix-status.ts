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
  | 'analyze-request'
  | 'analyzing'
  | 'analyzed'
  | 'analyze-failed'

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
  // analyze-request · analyzing · analyzed 메모. id 는 nonce
  verdict?: 'fix' | 'watch' | 'ignore'
  conf?: 'high' | 'mid' | 'low'
  auto?: 'yes' | 'no'
  issueNumber?: number
  // 서명(sig=)은 서버(api.ts listComments)에서만 검증한다 — 이 파일은 클라이언트에서도 쓰이므로 crypto 없음
}

const PR_URL = /^https:\/\/github\.com\/kaleos-platform\/[\w.-]+\/pull\/\d+$/
const KNOWN =
  /^autofix:(request|running|pr|analysis|failed|skip|ready|approve|analyze-request|analyzing|analyzed|analyze-failed)(\s|$)/

const NONCE = '(\\d{8}-\\d{6}-[0-9a-f]{8})'
const ANALYZE_REQUEST = new RegExp(
  `^autofix:analyze-request id=${NONCE} by=(admin|slack) sig=([0-9a-f]{32})$`
)
const ANALYZING = new RegExp(`^autofix:analyzing id=${NONCE} until=(\\S+)$`)
const ANALYZED = new RegExp(
  `^autofix:analyzed id=${NONCE} verdict=(fix|watch|ignore) conf=(high|mid|low) auto=(yes|no) issue=(\\d{1,7}) sig=([0-9a-f]{32})$`
)
const ANALYZE_FAILED = /^autofix:analyze-failed ([a-z0-9-]{1,40})$/

export const analysisIssueUrl = (n: number) =>
  `https://github.com/kaleos-platform/kaleos-ax-project/issues/${n}`

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
  const first = t.split('\n')[0]
  if (/^autofix:analyze-request(\s|$)/.test(t)) return ANALYZE_REQUEST.test(first)
  if (/^autofix:analyzing(\s|$)/.test(t)) return ANALYZING.test(first)
  if (/^autofix:analyzed(\s|$)/.test(t)) return ANALYZED.test(first)
  if (/^autofix:analyze-failed(\s|$)/.test(t)) return ANALYZE_FAILED.test(first)
  if (!/^autofix:(ready|approve)(\s|$)/.test(t)) return true
  const { id, sha } = kv(t)
  return PENDING_ID.test(id ?? '') && SHA.test(sha ?? '')
}

export function parseAutofixState(comments: Comment[]): AutofixState {
  const valid = comments
    .filter((c) => isValid(c.text))
    .sort((a, b) => Date.parse(b.dateCreated) - Date.parse(a.dateCreated))
  // analyzed 는 그보다 앞선 최신 analyze-request 의 nonce 와 같을 때만 인정 (과거 판정 재게시 차단)
  const latest = valid.find((c) => {
    const f = ANALYZED.exec(c.text.trim().split('\n')[0])
    if (!f) return true
    const req = valid.find(
      (r) =>
        Date.parse(r.dateCreated) < Date.parse(c.dateCreated) &&
        ANALYZE_REQUEST.test(r.text.trim().split('\n')[0])
    )
    return !!req && ANALYZE_REQUEST.exec(req.text.trim().split('\n')[0])![1] === f[1]
  })
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
    case 'analyze-request': {
      const f = kv(latest.text)
      return { kind: head, at, id: f.id, by: f.by === 'slack' ? 'slack' : 'admin' }
    }
    case 'analyzing': {
      const f = kv(latest.text)
      return { kind: head, at, id: f.id, until: f.until }
    }
    case 'analyzed': {
      const f = ANALYZED.exec(latest.text.trim().split('\n')[0])!
      return {
        kind: head,
        at,
        id: f[1],
        verdict: f[2] as AutofixState['verdict'],
        conf: f[3] as AutofixState['conf'],
        auto: f[4] as AutofixState['auto'],
        issueNumber: Number(f[5]),
      }
    }
    case 'analyze-failed':
      return { kind: head, at, reason: rest[0] }
    case 'failed':
      return { kind: 'failed', at, reason: arg || undefined }
    default:
      return { kind: 'none' }
  }
}

// 분석 요청은 이미 요청됨·분석 중(만료 전)이면 생략
export function shouldWriteNote(
  current: AutofixState,
  next: 'request' | 'skip' | 'analyze-request',
  now: number = Date.now()
): boolean {
  if (next === 'analyze-request' && current.kind === 'analyzing') return isUntilPassed(current, now)
  // 수정안 승인 흐름(ready·approve·진행 중 running)을 분석 요청으로 덮지 않는다
  if (next === 'analyze-request' && (current.kind === 'ready' || current.kind === 'approve'))
    return false
  if (next === 'analyze-request' && current.kind === 'running') return isUntilPassed(current, now)
  return current.kind !== next
}

export const isUntilPassed = (s: AutofixState, now: number = Date.now()) =>
  !!s.until && Date.parse(s.until) < now

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
  | 'analyze-requested'
  | 'analyzing'
  | 'analyzed'
  | 'analyze-failed'
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
  'analyze-requested': '분석 요청됨',
  analyzing: '분석 중',
  analyzed: '분석 완료',
  'analyze-failed': '분석 실패',
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
  'analyze-request': 'analyze-requested',
  analyzing: 'analyzing',
  analyzed: 'analyzed',
  'analyze-failed': 'analyze-failed',
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
