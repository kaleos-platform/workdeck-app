/**
 * 쿠팡 Open API CEA HMAC-SHA256 서명
 *
 * 문서(https://developers.coupang.com/hc/ko/articles/360033461914):
 *   message   = signedDate + method + path + query
 *   signedDate = GMT+0 "yyMMdd'T'HHmmss'Z'" (예: 180809T101530Z)
 *   query     = 앞의 '?' 제외한 쿼리 문자열 (없으면 빈 문자열)
 *   Authorization = "CEA algorithm=HmacSHA256, access-key={ak}, signed-date={date}, signature={hex}"
 *
 * 문서에 query 파라미터 정렬 여부가 명시돼 있지 않다 — 예제 코드(PHP/Python/C#) 모두
 * 호출 시 넘긴 파라미터 순서를 그대로 문자열화해 서명에 쓴다. 이 모듈도 호출자가 넘긴
 * query 문자열을 그대로 쓴다(정렬하지 않는다) — client.ts 가 실제 요청 URL과 동일한
 * 순서로 query 를 만들어 넘겨야 서명이 일치한다.
 */
import crypto from 'node:crypto'

/** GMT+0 "yyMMdd'T'HHmmss'Z'" 포맷의 signedDate 를 만든다. */
export function buildSignedDate(now: Date = new Date()): string {
  const yy = String(now.getUTCFullYear()).slice(-2)
  const MM = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const HH = String(now.getUTCHours()).padStart(2, '0')
  const mm = String(now.getUTCMinutes()).padStart(2, '0')
  const ss = String(now.getUTCSeconds()).padStart(2, '0')
  return `${yy}${MM}${dd}T${HH}${mm}${ss}Z`
}

export interface BuildAuthorizationOpts {
  method: string // 'GET' | 'POST' | ...
  path: string // '/v2/providers/rg_open_api/apis/api/v1/vendors/A00123/rg/inventory/summaries'
  query: string // 'nextToken=abc' — 앞의 '?' 제외, 빈 문자열 가능
  accessKey: string
  secretKey: string
  now?: Date // 테스트 주입용
}

/** message 문자열(signedDate+method+path+query)을 만든다. 테스트에서 signedDate 와 함께 검증용으로 노출. */
export function buildMessage(opts: {
  signedDate: string
  method: string
  path: string
  query: string
}): string {
  return `${opts.signedDate}${opts.method}${opts.path}${opts.query}`
}

/** 쿠팡 CEA Authorization 헤더 값을 만든다. */
export function buildAuthorization(opts: BuildAuthorizationOpts): string {
  const signedDate = buildSignedDate(opts.now)
  const message = buildMessage({
    signedDate,
    method: opts.method.toUpperCase(),
    path: opts.path,
    query: opts.query,
  })
  const signature = crypto
    .createHmac('sha256', opts.secretKey)
    .update(message, 'utf8')
    .digest('hex')
  return `CEA algorithm=HmacSHA256, access-key=${opts.accessKey}, signed-date=${signedDate}, signature=${signature}`
}
