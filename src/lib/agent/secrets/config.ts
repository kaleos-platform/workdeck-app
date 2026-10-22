import { isIP } from 'node:net'
import { z } from 'zod'
import { ToolUserError } from '@/lib/agent/tools/errors'

// API 키 config — 에이전트가 어떤 업스트림 경로·파라미터를 호출할 수 있는지 정하는 보안 경계.

export type ReadOp = {
  id: string
  method: 'GET' | 'POST'
  pathPattern: string
  // 키 → 값 정규식 문자열(전체 일치). 목록에 없는 키는 거부한다.
  query: Record<string, string>
  // body는 최상위 원시값만 받는다.
  body?: Record<string, string>
  responseFields: string[]
  responseHeaders: string[]
}

export type ApiKeyConfig = {
  baseUrl: string
  auth: { in: 'header'; name: string; template: string } | { in: 'query'; name: string }
  readOps: ReadOp[]
}

const NOT_READ_OP = '등록된 조회 operation이 아닙니다'
const FORBIDDEN_AUTH_HEADERS = new Set([
  'host',
  'cookie',
  'x-http-method-override',
  'x-method-override',
])
const SEGMENT_LITERAL = /^[A-Za-z0-9._~-]+$/
const SEGMENT_PARAM = /^\{[A-Za-z][A-Za-z0-9_]*\}$/
const FIELD_PATH = /^[A-Za-z0-9_-]+(\[\])?(\.[A-Za-z0-9_-]+(\[\])?)*$/

const isValidRegex = (s: string) => {
  try {
    new RegExp(s)
    return true
  } catch {
    return false
  }
}

const isValidBaseUrl = (s: string) => {
  if (/[?#]/.test(s)) return false
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return false
  if (u.port !== '' && u.port !== '443') return false
  // IPv6 literal은 hostname이 [..]로 오고, IPv4 literal(축약형 포함)은 URL이 점-십진수로 정규화한다.
  return !u.hostname.startsWith('[') && isIP(u.hostname) === 0
}

const isValidPathPattern = (p: string) => {
  if (!p.startsWith('/')) return false
  const segs = p.slice(1).split('/')
  return segs.every(
    (s) => s !== '.' && s !== '..' && (SEGMENT_LITERAL.test(s) || SEGMENT_PARAM.test(s))
  )
}

const regexMap = z.record(z.string(), z.string().refine(isValidRegex, '잘못된 정규식'))

const readOpSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  method: z.enum(['GET', 'POST']),
  pathPattern: z.string().refine(isValidPathPattern, '잘못된 pathPattern'),
  query: regexMap,
  body: regexMap.optional(),
  responseFields: z.array(z.string().regex(FIELD_PATH)),
  responseHeaders: z.array(z.string().regex(/^[A-Za-z0-9-]+$/)),
})

const authName = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)

export const apiKeyConfigSchema: z.ZodType<ApiKeyConfig> = z.object({
  baseUrl: z.string().refine(isValidBaseUrl, 'baseUrl은 https 도메인만 허용합니다'),
  auth: z.discriminatedUnion('in', [
    z.object({
      in: z.literal('header'),
      name: authName.refine(
        (n) => !FORBIDDEN_AUTH_HEADERS.has(n.toLowerCase()),
        '허용되지 않는 헤더'
      ),
      template: z
        .string()
        .max(256)
        .refine(
          (t) => t.split('{value}').length === 2 && !/[\r\n]/.test(t),
          'template에는 {value}가 한 번 필요합니다'
        ),
    }),
    z.object({ in: z.literal('query'), name: authName }),
  ]),
  readOps: z
    .array(readOpSchema)
    .max(50)
    .refine(
      (ops) => new Set(ops.map((o) => o.id)).size === ops.length,
      'operation id가 중복됩니다'
    ),
})

// 입력 그대로 반환한다(디코딩 안 함). 우회 가능성이 있는 형태는 모두 거부한다.
export function normalizePath(path: string): string {
  const bad = () => new ToolUserError('허용되지 않는 path입니다')
  if (typeof path !== 'string' || !path.startsWith('/')) throw bad()
  // %·?·#·\ 와 공백·제어문자 등은 문자 집합 밖이므로 함께 걸러진다.
  if (!/^[A-Za-z0-9._~/-]*$/.test(path) || path.includes('//')) throw bad()
  if (path.split('/').some((s) => s === '.' || s === '..')) throw bad()
  return path
}

const fullMatch = (re: string, v: string) => new RegExp(`^(?:${re})$`).test(v)

const patternToRegex = (p: string) =>
  new RegExp(
    '^' +
      p
        .slice(1)
        .split('/')
        .map((s) => (SEGMENT_PARAM.test(s) ? '/[A-Za-z0-9_-]+' : '/' + s.replace(/[.]/g, '\\.')))
        .join('') +
      '$'
  )

const keysAllowed = (
  vals: Record<string, unknown>,
  allow: Record<string, string>,
  str: (v: unknown) => string | null
) =>
  Object.keys(vals).every((k) => {
    if (!Object.hasOwn(allow, k)) return false
    const s = str(vals[k])
    return s !== null && fullMatch(allow[k], s)
  })

export function matchReadOp(
  cfg: ApiKeyConfig,
  req: {
    op: string
    method: string
    path: string
    query: Record<string, string>
    body?: Record<string, unknown>
  }
): ReadOp {
  const op = cfg.readOps.find((o) => o.id === req.op)
  if (!op || op.method !== req.method) throw new ToolUserError(NOT_READ_OP)
  let path: string
  try {
    path = normalizePath(req.path)
  } catch {
    throw new ToolUserError(NOT_READ_OP)
  }
  const okQuery = keysAllowed(req.query, op.query, (v) => (typeof v === 'string' ? v : null))
  const okBody = keysAllowed(req.body ?? {}, op.body ?? {}, (v) =>
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : null
  )
  if (!patternToRegex(op.pathPattern).test(path) || !okQuery || !okBody)
    throw new ToolUserError(NOT_READ_OP)
  return op
}

type Json = unknown
const isObj = (v: Json): v is Record<string, Json> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function pick(src: Json, segs: string[]): Json {
  if (segs.length === 0) return src
  const [head, ...rest] = segs
  if (head === '[]') return Array.isArray(src) ? src.map((e) => pick(e, rest) ?? {}) : undefined
  if (!isObj(src) || head === '__proto__' || !Object.hasOwn(src, head)) return undefined
  const v = pick(src[head], rest)
  return v === undefined ? undefined : { [head]: v }
}

function merge(a: Json, b: Json): Json {
  if (Array.isArray(a) && Array.isArray(b)) return a.map((e, i) => merge(e, b[i]))
  if (isObj(a) && isObj(b)) {
    const out: Record<string, Json> = { ...a }
    for (const k of Object.keys(b)) out[k] = k in out ? merge(out[k], b[k]) : b[k]
    return out
  }
  return b
}

// 경로 문법: `a.b`, 배열은 `items[].name`. 허용 목록에 없는 필드는 결과에서 빠지고 원본 구조는 유지한다.
export function pickFields(json: unknown, paths: string[]): unknown {
  let out: Json = {}
  for (const p of paths) {
    const segs = p.replace(/\[\]/g, '.[]').split('.').filter(Boolean)
    const v = pick(json, segs)
    if (v !== undefined) out = merge(out, v)
  }
  return out
}
