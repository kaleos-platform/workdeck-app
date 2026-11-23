// 인증 프록시(Node 내장만): 컨테이너에는 토큰이 없고, 이 프로세스만 읽기 전용 auth.json 을 읽는다.
// POST /v1/responses · GET /v1/models 만 고정 업스트림으로 중계한다. 요청마다 공유 비밀값 헤더를 확인한다.
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  inspectBody,
  MAX_BODY_BYTES,
  PASS_RESPONSE_HEADERS,
  routeFor,
  upstreamHeaders,
} from './check.mjs'

const noop = () => {}
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest()

// upstream: { protocol: 'https' | 'http', host, port } — 테스트는 인자로 가짜 업스트림을 주입한다
export function createProxy({
  upstream,
  authPath,
  model,
  maxRequests,
  secret,
  log = console.log,
  maxLogLines = 500,
  maxConcurrent = 4,
}) {
  let count = 0
  let active = 0
  let logged = 0
  const lib = upstream.protocol === 'http' ? http : https
  const secretDigest = digest(secret)
  const say = (line) => {
    if (logged < maxLogLines) log(line)
    else if (logged === maxLogLines) log('LOG-CAP')
    logged++
  }
  const deny = (res, code, why, key) => {
    say(`DENY ${key} ${why}`)
    if (!res.headersSent) res.writeHead(code, { connection: 'close' })
    res.end()
  }
  const handle = (req, res) => {
    const key = `${req.method} ${String(req.url)
      .split('?')[0]
      .slice(0, 80)
      .replace(/[^\x20-\x7e]/g, '?')}`
    // 거부 요청도 상한에 포함한다
    if (++count > maxRequests) return deny(res, 429, 'request-cap', key)
    const given = req.headers['x-autofix-secret']
    if (typeof given !== 'string' || !crypto.timingSafeEqual(digest(given), secretDigest))
      return deny(res, 403, 'secret', key)
    const path = routeFor(req.method, req.url)
    if (!path) return deny(res, 403, 'route', key)
    if (active >= maxConcurrent) return deny(res, 429, 'busy', key)
    active++
    res.on('close', () => active--)
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        deny(res, 413, 'too-large', key)
        req.destroy()
      } else chunks.push(c)
    })
    req.on('error', noop)
    req.on('end', () => {
      try {
        if (res.writableEnded) return
        let payload
        let tools = []
        if (req.method === 'POST') {
          const r = inspectBody(Buffer.concat(chunks), req.headers, { model })
          if (!r.ok) return deny(res, 403, r.reason, key)
          payload = r.canonical // 검사한 객체를 다시 직렬화한 것만 전달
          tools = r.tools
        }
        let tokens
        try {
          tokens = JSON.parse(fs.readFileSync(authPath, 'utf8')).tokens
        } catch {
          return deny(res, 500, 'auth-unreadable', key)
        }
        const headers = upstreamHeaders(req.headers, tokens, { json: payload !== undefined })
        if (payload) headers['content-length'] = payload.length
        const up = lib.request(
          { host: upstream.host, port: upstream.port, path, method: req.method, headers },
          (r) => {
            say(`${key} ${r.statusCode} tools=${tools.join(',')}`)
            const out = {}
            for (const h of PASS_RESPONSE_HEADERS) if (r.headers[h]) out[h] = r.headers[h]
            res.writeHead(r.statusCode, out)
            pipeline(r, res, noop)
          }
        )
        up.setTimeout(15 * 60_000, () => up.destroy())
        up.on('error', (e) => deny(res, 502, `upstream:${e.code}`, key))
        // 클라이언트가 먼저 끊으면 업스트림 요청도 중단한다
        res.on('close', () => {
          if (!res.writableFinished) up.destroy()
        })
        up.end(payload)
      } catch {
        deny(res, 400, 'handler-error', key)
      }
    })
  }
  const server = http.createServer((req, res) => {
    try {
      handle(req, res)
    } catch {
      try {
        res.writeHead(400, { connection: 'close' })
        res.end()
      } catch {}
    }
  })
  server.on('connection', (s) => s.on('error', noop))
  server.on('clientError', (_e, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n')
    socket.destroy()
  })
  // CONNECT 등은 중계하지 않는다
  server.on('connect', (_req, socket) => {
    socket.on('error', noop)
    socket.end('HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n')
  })
  server.requestTimeout = 60_000
  return server
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.PROXY_SECRET || !process.env.PROXY_MODEL) {
    console.error('PROXY_SECRET/PROXY_MODEL 필요')
    process.exit(1)
  }
  createProxy({
    upstream: { protocol: 'https', host: 'chatgpt.com', port: 443 },
    authPath: '/auth/auth.json',
    model: process.env.PROXY_MODEL,
    maxRequests: Number(process.env.PROXY_MAX_REQUESTS ?? 200),
    secret: process.env.PROXY_SECRET,
  }).listen(8080, '0.0.0.0', () => console.log('listening'))
}
