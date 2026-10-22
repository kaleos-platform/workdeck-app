import { displayUrl, normalizePath, pickFields, type ApiKeyConfig, type ReadOp } from './config'
import { maskSecrets } from '@/lib/agent/audit'
import { ToolUserError } from '@/lib/agent/tools/errors'

export interface CallInput {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query: Record<string, string>
  body?: Record<string, unknown>
}

/** 업스트림 요청 조립. 인증은 서버가 config대로 주입하고, 호출자 헤더 입력은 받지 않는다. */
export function buildRequest(
  value: string,
  config: ApiKeyConfig,
  input: CallInput
): { url: URL; headers: Record<string, string>; body?: string } {
  const query = input.query ?? {}
  const authName = config.auth.name
  if (
    config.auth.in === 'query' &&
    Object.keys(query).some((k) => k.toLowerCase() === authName.toLowerCase())
  ) {
    throw new ToolUserError('허용되지 않는 query입니다')
  }
  // 승인 화면 표시 URL과 같은 조립(displayUrl).
  const url = new URL(displayUrl(config.baseUrl, normalizePath(input.path)))
  for (const [k, v] of Object.entries(query)) url.searchParams.append(k, v)
  const headers: Record<string, string> = { accept: 'application/json' }
  if (config.auth.in === 'header') {
    // 함수 치환자: value 안의 `$&` 같은 패턴이 해석되지 않게 한다.
    headers[config.auth.name.toLowerCase()] = config.auth.template.replace('{value}', () => value)
  } else {
    url.searchParams.set(config.auth.name, value)
  }
  if (input.body === undefined) return { url, headers }
  headers['content-type'] = 'application/json'
  return { url, headers, body: JSON.stringify(input.body) }
}

/**
 * 응답에서 허용된 필드·헤더만 남긴다. op=null(승인 실행)·json=null(JSON 아님·처리 불가)은 상태 코드만(spec §3.4).
 * set-cookie는 admin이 허용해도 항상 뺀다. 그 뒤 키 원문·base64·URL 인코딩을 가리고 maskSecrets로 한 번 더 거른다(보조).
 */
export function filterResponse(
  op: ReadOp | null,
  res: { status: number; headers: Record<string, string>; json: unknown },
  value: string
): { status: number; body?: unknown; headers?: Record<string, string> } {
  if (!op || res.json === null) return { status: res.status }
  const allowed = new Set(op.responseHeaders.map((h) => h.toLowerCase()))
  allowed.delete('set-cookie')
  // 퍼센트 hex는 대소문자가 섞일 수 있어 대소문자 무시. 긴 것부터 맞춘다(교대는 앞의 것이 먼저 맞는다).
  const needles = [
    ...new Set([
      value,
      Buffer.from(value).toString('base64'),
      encodeURIComponent(value),
      new URLSearchParams({ k: value }).toString().slice(2),
    ]),
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = needles.length ? new RegExp(needles.join('|'), 'gi') : null
  const redact = (s: string) => maskSecrets(re ? s.replace(re, '[redacted]') : s)
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return redact(v)
    // 숫자·불리언으로 echo된 키도 가린다
    if (re && (typeof v === 'number' || typeof v === 'boolean')) {
      re.lastIndex = 0
      return re.test(String(v)) ? '[redacted]' : v
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [redact(k), walk(x)]))
    return v
  }
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(res.headers)) {
    const lk = k.toLowerCase()
    if (allowed.has(lk)) headers[lk] = redact(v)
  }
  return { status: res.status, body: walk(pickFields(res.json, op.responseFields)), headers }
}
