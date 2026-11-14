// 위킵(3PL) 포털 재고 조회 — 서버가 직접 HTTP 로그인 후 재고 JSON API를 페이지 반복한다.
// 비밀번호는 로그인 요청 본문에만 쓰고 에러·로그에 싣지 않는다(고정 한국어 문구만 던진다).

const BASE = 'https://fbw.wekeep.co.kr/fbw'
const PAGE_SIZE = 100
const MAX_PAGES = 50
const TIMEOUT_MS = 15_000

export type WekeepErrorCode = 'LOGIN_FAILED' | 'BLOCKED' | 'UNEXPECTED'

const MESSAGES: Record<WekeepErrorCode, string> = {
  LOGIN_FAILED: '위킵 로그인에 실패했습니다. 위치 관리의 위킵 로그인 비밀값을 확인해 주세요.',
  BLOCKED: '위킵 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  UNEXPECTED: '위킵 재고 응답을 해석하지 못했습니다.',
}

export class WekeepError extends Error {
  constructor(readonly code: WekeepErrorCode) {
    super(MESSAGES[code])
    this.name = 'WekeepError'
  }
}

export type WekeepInventoryRow = {
  skuNo: string
  productName: string
  available: number
  reserve: number
  faulty: number
  damage: number
}

const isLoginLocation = (loc: string | null) => !!loc && /login|j_spring_security/i.test(loc)

export async function fetchWekeepInventory(
  cred: { username: string; password: string },
  fetchImpl: typeof fetch = fetch
): Promise<WekeepInventoryRow[]> {
  // 네트워크·타임아웃 오류는 원인(URL·본문)을 버리고 BLOCKED로만 던진다.
  const call = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetchImpl(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new WekeepError('BLOCKED')
    }
  }

  // 1) 로그인 — 성공 시 세션 쿠키(Set-Cookie). 로그인 페이지로 되돌아가면 실패.
  const login = await call(`${BASE}/j_spring_security_check`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      j_username: cred.username,
      j_password: cred.password,
      _spring_security_remember_me: 'on',
    }).toString(),
  })
  if (login.status >= 300 && login.status < 400 && isLoginLocation(login.headers.get('location')))
    throw new WekeepError('LOGIN_FAILED')
  if (login.status >= 400) throw new WekeepError('BLOCKED')
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  if (!cookie) throw new WekeepError('LOGIN_FAILED')

  // 2) 재고 페이지 반복 — HTML·로그인 리다이렉트는 세션 만료/로그인 실패.
  const rows: WekeepInventoryRow[] = []
  let total = Infinity
  for (let page = 1; page <= MAX_PAGES && rows.length < total; page++) {
    const res = await call(`${BASE}/admin/v2/inventory/search?searchInventoryType=INVENTORY`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        cookie,
      },
      body: JSON.stringify({ page, pageSize: PAGE_SIZE }),
    })
    if (res.status >= 300 && res.status < 400) throw new WekeepError('LOGIN_FAILED')
    if (res.status >= 400) throw new WekeepError('BLOCKED')
    if (!(res.headers.get('content-type') ?? '').includes('json'))
      throw new WekeepError('LOGIN_FAILED')
    let json: {
      result?: unknown
      data?: { inventoryCnt?: unknown; inventoryList?: unknown }
    }
    try {
      json = await res.json()
    } catch {
      throw new WekeepError('UNEXPECTED')
    }
    const list = json?.data?.inventoryList
    const cnt = json?.data?.inventoryCnt
    if (json?.result !== true || !Array.isArray(list) || typeof cnt !== 'number')
      throw new WekeepError('UNEXPECTED')
    total = cnt
    if (list.length === 0) break
    for (const r of list as Record<string, unknown>[]) {
      if (typeof r?.skuNo !== 'string' || !r.skuNo) throw new WekeepError('UNEXPECTED')
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
      rows.push({
        skuNo: r.skuNo,
        productName: typeof r.productName === 'string' ? r.productName : '',
        available: n(r.availableQty),
        reserve: n(r.reserveQty),
        faulty: n(r.faultyQty),
        damage: n(r.damageQty),
      })
    }
  }
  // 페이지 상한으로 끝났는데 아직 덜 모았으면 부분 재고로 대조하지 않는다.
  if (rows.length < total) throw new WekeepError('UNEXPECTED')
  return rows
}
