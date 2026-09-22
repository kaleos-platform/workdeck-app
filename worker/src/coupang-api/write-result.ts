/**
 * 쿠팡 쓰기 API 응답 해석 — 단일 지점.
 *
 * 성공 판정은 HTTP 상태가 아니라 **중첩된 data.code** 다:
 *   { "code":"200", "message":"", "data": { "code":"SUCCESS", "message":"", "data": 427011919 } }
 *
 * HTTP 200 을 성공으로 읽으면 "가격이 반영됐다"고 보고하고 실제로는 안 바뀐다.
 * 이 프로젝트의 무음 실패 5건이 전부 같은 유형(타입이 실물과 달라 조용히 undefined)이었다.
 */
export class CoupangWriteError extends Error {
  readonly coupangMessage: string
  readonly httpStatus?: number

  constructor(coupangMessage: string, httpStatus?: number) {
    super(`쿠팡 쓰기 실패: ${coupangMessage}`)
    this.name = 'CoupangWriteError'
    this.coupangMessage = coupangMessage
    this.httpStatus = httpStatus
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** 성공이면 쿠팡이 돌려준 내부 data(보통 vendorItemId)를 반환, 아니면 CoupangWriteError. */
export function unwrapWriteResult(body: unknown, httpStatus: number): number {
  if (!body || typeof body !== 'object') {
    throw new CoupangWriteError(`응답 본문을 해석할 수 없습니다 (HTTP ${httpStatus})`, httpStatus)
  }
  const outer = body as Record<string, unknown>

  const inner = outer.data
  if (inner && typeof inner === 'object') {
    const d = inner as Record<string, unknown>
    if (d.code === 'SUCCESS') {
      const value = d.data
      // data 가 숫자가 아닌 응답도 있을 수 있으나, 성공 판정 자체는 code 가 결정한다.
      return typeof value === 'number' ? value : 0
    }
    if (d.code === 'ERROR') {
      throw new CoupangWriteError(
        str(d.message) ?? str(outer.message) ?? '쿠팡이 요청을 거부했습니다',
        httpStatus
      )
    }
  }

  // 400 계열은 중첩 data 없이 최상위 message 만 온다.
  const top = str(outer.message)
  if (top) throw new CoupangWriteError(top, httpStatus)

  throw new CoupangWriteError(`알 수 없는 응답 형태 (HTTP ${httpStatus})`, httpStatus)
}
