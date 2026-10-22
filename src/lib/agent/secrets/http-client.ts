/**
 * 비밀 키를 싣는 요청 전용 HTTPS 클라이언트.
 * - 리다이렉트 금지(3xx는 REDIRECT로 종료), 사전 DNS 검사 + 연결 시점 lookup 재검사(secureLookup)
 * - hop 전체 15초, 본문 1MB 상한
 * - 오류는 코드만 담는다(URL·헤더·Location·본문 없음). 업스트림 본문은 절대 오류에 싣지 않는다.
 */
import https from 'node:https'

import { secureLookup, validateHostAddresses, SafeFetchError } from '@/lib/net/safe-fetch'

export type SecretHttpErrorCode =
  | 'REDIRECT'
  | 'PRIVATE_ADDRESS'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'NETWORK'

export class SecretHttpError extends Error {
  readonly code: SecretHttpErrorCode

  constructor(code: SecretHttpErrorCode) {
    super(code)
    this.name = 'SecretHttpError'
    this.code = code
  }
}

export interface SecretRequest {
  url: URL
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers: Record<string, string>
  body?: string
}

export interface SecretResponse {
  status: number
  headers: Record<string, string>
  json: unknown | null
}

const TIMEOUT_MS = 15000
const MAX_BYTES = 1024 * 1024

/** 응답 본문을 상한까지 읽는다. 상한 초과 시 연결을 끊고 TOO_LARGE. */
async function readBody(res: import('node:http').IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of res as AsyncIterable<Buffer>) {
    total += chunk.byteLength
    if (total > MAX_BYTES) {
      res.destroy()
      throw new SecretHttpError('TOO_LARGE')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function send(r: SecretRequest): Promise<SecretResponse> {
  return new Promise((resolve, reject) => {
    let res: import('node:http').IncomingMessage | undefined
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const fail = (code: SecretHttpErrorCode) => {
      finish(() => reject(new SecretHttpError(code)))
      res?.destroy()
      req?.destroy()
    }

    // hop 전체(연결·헤더·본문)를 감싸는 타이머
    const timer = setTimeout(() => fail('TIMEOUT'), TIMEOUT_MS)

    const req: import('node:http').ClientRequest = https.request(
      {
        method: r.method,
        hostname: r.url.hostname,
        port: r.url.port ? Number(r.url.port) : 443,
        path: `${r.url.pathname}${r.url.search}`,
        lookup: secureLookup,
        servername: r.url.hostname,
        // accept는 호출자 값보다 고정값이 우선한다
        headers: { ...r.headers, accept: 'application/json' },
      },
      (incoming) => {
        res = incoming
        incoming.on('error', () => fail('NETWORK'))
        const status = incoming.statusCode ?? 0
        if (status >= 300 && status < 400) {
          incoming.resume()
          fail('REDIRECT')
          return
        }
        readBody(incoming).then(
          (buf) =>
            finish(() => {
              const headers: Record<string, string> = {}
              for (const [k, v] of Object.entries(incoming.headers)) {
                if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v
              }
              const ct = (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
              let json: unknown | null = null
              if (ct === 'application/json' || ct.endsWith('+json')) {
                try {
                  json = JSON.parse(buf.toString('utf8'))
                } catch {
                  reject(new SecretHttpError('NETWORK'))
                  return
                }
              }
              resolve({ status, headers, json })
            }),
          (err: unknown) => fail(err instanceof SecretHttpError ? err.code : 'NETWORK')
        )
      }
    )
    req.on('error', (err) =>
      fail((err as NodeJS.ErrnoException).code === 'EPRIVATEADDR' ? 'PRIVATE_ADDRESS' : 'NETWORK')
    )
    req.end(r.body)
  })
}

export async function secretRequest(r: SecretRequest): Promise<SecretResponse> {
  if (r.url.protocol !== 'https:') throw new SecretHttpError('NETWORK')
  try {
    await validateHostAddresses(r.url.hostname)
  } catch (err) {
    // 메시지에 호스트·주소가 들어 있으므로 코드만 취한다
    throw new SecretHttpError(
      err instanceof SafeFetchError && err.code === 'PRIVATE_ADDRESS'
        ? 'PRIVATE_ADDRESS'
        : 'NETWORK'
    )
  }
  return send(r)
}
