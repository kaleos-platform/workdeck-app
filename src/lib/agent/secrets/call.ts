import { normalizePath, pickFields, type ApiKeyConfig, type ReadOp } from './config'
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
  const url = new URL(config.baseUrl.replace(/\/+$/, '') + normalizePath(input.path))
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
 * 응답에서 허용된 필드·헤더만 남긴다. op=null(승인 실행)은 상태 코드만.
 * set-cookie는 admin이 허용해도 항상 뺀다. 마지막으로 키 원문·base64·URL 인코딩이 남아 있으면 가린다(보조).
 */
export function filterResponse(
  op: ReadOp | null,
  res: { status: number; headers: Record<string, string>; json: unknown },
  value: string
): { status: number; body?: unknown; headers?: Record<string, string> } {
  if (!op) return { status: res.status }
  const allowed = new Set(op.responseHeaders.map((h) => h.toLowerCase()))
  allowed.delete('set-cookie')
  const needles = [value, Buffer.from(value).toString('base64'), encodeURIComponent(value)]
  const redact = (s: string) =>
    needles.reduce((acc, n) => (n ? acc.split(n).join('[redacted]') : acc), s)
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return redact(v)
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
