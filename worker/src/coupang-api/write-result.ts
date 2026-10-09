/**
 * 쿠팡 쓰기 API 응답 해석 — 단일 지점.
 *
 * 성공 판정은 HTTP 상태가 아니라 응답 본문의 code 다. 쿠팡은 두 형태를 쓴다:
 *   (문서) { "code":"200", "message":"", "data": { "code":"SUCCESS", "message":"", "data": 427011919 } }
 *   (실측 2026-10-09, 가격 변경) { "code":"SUCCESS", "message":"가격 변경을 완료했습니다.", ... }
 * 두 번째 형태를 몰라 성공을 "쿠팡 쓰기 실패: 가격 변경을 완료했습니다."로 보고한 사고가 있었다.
 * 최종 판정은 price-change.ts 가 쓰기 후 현재가를 다시 읽어 확정한다(이 함수는 1차 판정).
 *
 * HTTP 200 을 성공으로 읽으면 "가격이 반영됐다"고 보고하고 실제로는 안 바뀐다.
 * 이 프로젝트의 무음 실패 5건이 전부 같은 유형(타입이 실물과 달라 조용히 undefined)이었다.
 */
export class CoupangWriteError extends Error {
  readonly coupangMessage: string
  readonly httpStatus?: number
  /** 감사용 원문(최대 500자) — 응답 형태가 또 바뀌면 이걸로 진단한다. */
  readonly rawBody?: string

  constructor(coupangMessage: string, httpStatus?: number, rawBody?: string) {
    super(`쿠팡 쓰기 실패: ${coupangMessage}`)
    this.name = 'CoupangWriteError'
    this.coupangMessage = coupangMessage
    this.httpStatus = httpStatus
    this.rawBody = rawBody
  }
}

function raw(body: unknown): string {
  try {
    return JSON.stringify(body).slice(0, 500)
  } catch {
    return String(body).slice(0, 500)
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

  // 최상위 code 가 SUCCESS 인 형태(실측). 중첩 data 가 따로 ERROR 를 말하면 그쪽을 따른다.
  const innerCode =
    outer.data && typeof outer.data === 'object'
      ? (outer.data as Record<string, unknown>).code
      : undefined
  if (outer.code === 'SUCCESS' && innerCode !== 'ERROR') {
    return typeof outer.data === 'number' ? outer.data : 0
  }

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
        httpStatus,
        raw(body)
      )
    }
  }

  // 400 계열은 중첩 data 없이 최상위 message 만 온다.
  const top = str(outer.message)
  if (top) throw new CoupangWriteError(top, httpStatus, raw(body))

  throw new CoupangWriteError(`알 수 없는 응답 형태 (HTTP ${httpStatus})`, httpStatus, raw(body))
}
