import 'server-only'
import { verifyNoteSig } from './autofix-sig'

const BASE = 'https://sentry.io/api/0'
const org = () => process.env.SENTRY_ORG ?? 'kaleos'
const project = () => process.env.SENTRY_PROJECT ?? 'workdeck-app'

export type SentryIssue = {
  id: string
  shortId: string
  title: string
  culprit: string
  permalink: string
  count: number
  userCount: number
  firstSeen: string
  lastSeen: string
  numComments: number
  service: 'web' | 'worker'
}

export function isSentryApiConfigured(): boolean {
  return !!process.env.SENTRY_API_TOKEN
}

function assertIssueId(issueId: string) {
  if (!/^\d+$/.test(issueId)) throw new Error('잘못된 Sentry issueId')
}

async function sentryFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.SENTRY_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Sentry API ${res.status}`)
  return res.json()
}

export async function listIssues(service: 'web' | 'worker'): Promise<SentryIssue[]> {
  const q = `is:unresolved environment:production lastSeen:-14d ${service === 'worker' ? '' : '!'}service:worker`
  const params = new URLSearchParams({ query: q, statsPeriod: '14d', sort: 'user', limit: '25' })
  const data = (await sentryFetch(`/projects/${org()}/${project()}/issues/?${params}`)) as Record<
    string,
    unknown
  >[]
  return data.map((i) => ({
    id: String(i.id),
    shortId: String(i.shortId),
    title: String(i.title),
    culprit: String(i.culprit ?? ''),
    permalink: String(i.permalink),
    count: Number(i.count),
    userCount: Number(i.userCount ?? 0),
    firstSeen: String(i.firstSeen),
    lastSeen: String(i.lastSeen),
    numComments: Number(i.numComments ?? 0),
    service,
  }))
}

// ready · approve 노트는 서명이 맞는 것만 인정한다 (Sentry 접근권만으로 위조 불가)
function isAuthentic(issueId: string, text: string): boolean {
  const first = text.trim().split('\n')[0]
  const kind = /^autofix:(ready|approve)(\s|$)/.exec(first)?.[1] as 'ready' | 'approve' | undefined
  if (!kind) return true
  const f = Object.fromEntries([...first.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]))
  return verifyNoteSig(kind, issueId, f.id ?? '', f.sha ?? '', f.sig)
}

export async function listComments(
  issueId: string
): Promise<{ text: string; dateCreated: string }[]> {
  assertIssueId(issueId)
  const data = (await sentryFetch(`/organizations/${org()}/issues/${issueId}/comments/`)) as {
    data?: { text?: string }
    dateCreated: string
  }[]
  return data
    .map((c) => ({ text: c.data?.text ?? '', dateCreated: c.dateCreated }))
    .filter((c) => isAuthentic(issueId, c.text))
}

export async function addComment(issueId: string, text: string): Promise<void> {
  assertIssueId(issueId)
  await sentryFetch(`/organizations/${org()}/issues/${issueId}/comments/`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}
