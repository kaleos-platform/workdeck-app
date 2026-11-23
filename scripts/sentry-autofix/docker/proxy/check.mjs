// 인증 프록시 순수 검사 함수 — 네트워크·파일 접근 없음(단위 테스트 대상)
export const ROUTES = {
  'POST /v1/responses': '/backend-api/codex/responses',
  'GET /v1/models': '/backend-api/codex/models',
}
export const MAX_BODY_BYTES = 8 * 1024 * 1024
export const MAX_DEPTH = 32

// 서버가 실행하는 도구(web_search 등)는 거부, 모델 쪽에서 호출하는 로컬 도구만 허용.
// 도구 필드도 허용 목록(codex 0.167 실측 캡처 기준) — server_url·connector_id·headers 등은 거부한다
const TOOL_FIELDS = {
  function: ['type', 'name', 'description', 'parameters', 'strict'],
  custom: ['type', 'name', 'description', 'format'],
  local_shell: ['type'],
  namespace: ['type', 'name', 'description', 'tools'],
}
function badTool(tools, depth = 0) {
  if (!Array.isArray(tools) || depth > 4) return 'bad-tools'
  for (const t of tools) {
    const allowed = typeof t?.type === 'string' ? TOOL_FIELDS[t.type] : undefined
    if (!allowed || typeof t !== 'object')
      return typeof t?.type === 'string' ? t.type.slice(0, 30) : 'bad-type'
    const extra = Object.keys(t).find((k) => !allowed.includes(k))
    if (extra) return `${t.type}.${extra.slice(0, 30)}`
    if (t.type === 'namespace') {
      const inner = badTool(t.tools ?? [], depth + 1)
      if (inner) return inner
    }
  }
  return null
}

const TOP_KEYS = new Set([
  'model',
  'instructions',
  'input',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'reasoning',
  'store',
  'stream',
  'include',
  'prompt_cache_key',
  'text',
  'client_metadata',
])
const ITEM_TYPES = new Set([
  'message',
  'reasoning',
  'function_call',
  'function_call_output',
  'custom_tool_call',
  'custom_tool_call_output',
  'local_shell_call',
  'local_shell_call_output',
  'additional_tools',
])
const PART_FIELDS = {
  input_text: ['type', 'text'],
  output_text: ['type', 'text', 'annotations', 'logprobs'],
  input_image: ['type', 'image_url', 'detail'],
}
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]*$/
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const onlyKeys = (o, keys) => isObj(o) && Object.keys(o).every((k) => keys.includes(k))

// 요청 헤더 통과 목록(codex 실측 헤더 중 업스트림에 필요한 최소). content-type 은 따로 고정한다
const PASS_REQUEST_HEADERS = [
  'accept',
  'user-agent',
  'originator',
  'session-id',
  'thread-id',
  'x-client-request-id',
]
export const PASS_RESPONSE_HEADERS = ['content-type', 'retry-after']

// 메서드·요청 대상 검사. 절대 URL(origin-form 아님)·알 수 없는 경로·파싱 불가 대상은 null
export function routeFor(method, target) {
  try {
    if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//'))
      return null
    const u = new URL(target, 'http://proxy.invalid')
    const upstream = ROUTES[`${method} ${u.pathname}`]
    if (!upstream) return null
    const q = u.searchParams.get('client_version')
    return upstream + (q && /^[\w.]+$/.test(q) ? `?client_version=${q}` : '')
  } catch {
    return null
  }
}

// 클라이언트 헤더 중 통과시킬 것만 + 우리 인증(authorization·cookie·계정 헤더는 전부 덮어쓰거나 제거)
export function upstreamHeaders(clientHeaders, tokens, { json = false } = {}) {
  const h = {}
  for (const k of PASS_REQUEST_HEADERS) if (clientHeaders[k]) h[k] = clientHeaders[k]
  if (json) h['content-type'] = 'application/json'
  h.authorization = `Bearer ${tokens.access_token}`
  h['chatgpt-account-id'] = tokens.account_id
  return h
}

// JSON 중첩 깊이를 재귀 없이 문자 단위로 센다(문자열 안의 괄호는 무시)
export function jsonDepthExceeds(text, max = MAX_DEPTH) {
  let depth = 0
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (inStr) {
      if (c === 92)
        i++ // 백슬래시
      else if (c === 34) inStr = false
    } else if (c === 34) inStr = true
    else if (c === 91 || c === 123) {
      if (++depth > max) return true
    } else if (c === 93 || c === 125) depth--
  }
  return false
}

function scan(node, path, errors) {
  if (Array.isArray(node)) return node.forEach((v, i) => scan(v, `${path}[${i}]`, errors))
  if (!node || typeof node !== 'object') return
  for (const [k, v] of Object.entries(node)) {
    if (k === 'file_url' || k === 'file_id') errors.push(`${path}.${k}`)
    else if (k === 'image_url') {
      const url = typeof v === 'string' ? v : v?.url
      if (typeof url !== 'string' || !DATA_IMAGE.test(url)) errors.push(`${path}.image_url`)
    } else scan(v, `${path}.${k}`, errors)
  }
}

// content/output 항목: 문자열 또는 허용된 종류의 parts 배열
function badParts(content) {
  if (content === undefined || typeof content === 'string') return null
  if (!Array.isArray(content)) return 'content-shape'
  for (const p of content) {
    const f = typeof p?.type === 'string' ? PART_FIELDS[p.type] : undefined
    if (!f) return `part:${typeof p?.type === 'string' ? p.type.slice(0, 30) : 'bad'}`
    if (!onlyKeys(p, f)) return `part-field:${p.type}`
    if (p.type === 'input_image' && !DATA_IMAGE.test(String(p.image_url))) return 'image-url'
  }
  return null
}

// POST 본문 검사. 반환: { ok, reason?, canonical?, tools? } — 업스트림에는 canonical(검사한 객체를 다시 직렬화)만 보낸다
export function inspectBody(buf, headers, { model }) {
  const no = (reason) => ({ ok: false, reason })
  if (headers['content-encoding']) return no('encoded-body')
  if (!/^application\/json\b/i.test(headers['content-type'] ?? '')) return no('not-json')
  if (buf.length > MAX_BODY_BYTES) return no('too-large')
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return no('bad-utf8')
  }
  if (jsonDepthExceeds(text)) return no('too-deep')
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return no('bad-json')
  }
  if (!isObj(body)) return no('bad-body')
  const extra = Object.keys(body).find((k) => !TOP_KEYS.has(k))
  if (extra) return no(`top-key-not-allowed:${extra.slice(0, 30)}`)
  if (body.model !== model) return no('model-not-allowed')
  if (body.store !== undefined && body.store !== false) return no('store-not-false')
  body.store = false
  if (body.tool_choice !== undefined && !['auto', 'none', 'required'].includes(body.tool_choice))
    return no('tool-choice-not-allowed')
  for (const k of ['parallel_tool_calls', 'stream'])
    if (body[k] !== undefined && typeof body[k] !== 'boolean') return no(`bad-${k}`)
  for (const k of ['instructions', 'prompt_cache_key'])
    if (body[k] !== undefined && (typeof body[k] !== 'string' || body[k].length > 2_000_000))
      return no(`bad-${k}`)
  if (
    body.include !== undefined &&
    !(Array.isArray(body.include) && body.include.every((x) => x === 'reasoning.encrypted_content'))
  )
    return no('bad-include')
  if (
    body.reasoning !== undefined &&
    !onlyKeys(body.reasoning, ['effort', 'summary', 'context', 'generate_summary'])
  )
    return no('bad-reasoning')
  if (body.text !== undefined && !onlyKeys(body.text, ['verbosity', 'format']))
    return no('bad-text')
  if (
    body.client_metadata !== undefined &&
    !(
      isObj(body.client_metadata) &&
      Object.values(body.client_metadata).every((v) => typeof v === 'string')
    )
  )
    return no('bad-client-metadata')
  if (body.tools !== undefined) {
    const bad = badTool(body.tools)
    if (bad) return no(`tool-not-allowed:${bad}`)
  }
  const input = Array.isArray(body.input) ? body.input : typeof body.input === 'string' ? [] : null
  if (input === null) return no('bad-input')
  for (const item of input) {
    const type = typeof item?.type === 'string' ? item.type : item?.role ? 'message' : undefined
    if (!ITEM_TYPES.has(type)) return no(`input-item-not-allowed:${String(type).slice(0, 30)}`)
    if (type === 'additional_tools') {
      const inner = badTool(item.tools)
      if (inner) return no(`tool-not-allowed:${inner}`)
    }
    const parts = badParts(
      type === 'function_call_output' || type === 'custom_tool_call_output'
        ? item.output
        : type === 'message'
          ? item.content
          : undefined
    )
    if (parts) return no(`content-not-allowed:${parts}`)
  }
  const errors = []
  scan(body.input, 'input', errors)
  if (errors.length) return no(`remote-reference:${errors[0].slice(0, 40)}`)
  return {
    ok: true,
    canonical: Buffer.from(JSON.stringify(body)),
    tools: Array.isArray(body.tools) ? body.tools.map((t) => t.type) : [],
  }
}
