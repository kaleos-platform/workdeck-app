// 주소 → 우편번호 조회 (카카오 Local API).
// 배송 등록에서 우편번호가 비어있을 때 주소 문자열로 우편번호를 역산한다.
// env: KAKAO_REST_API_KEY (developers.kakao.com REST API 키)

const KAKAO_ADDR_URL = 'https://dapi.kakao.com/v2/local/search/address.json'
const TIMEOUT_MS = 5000

/** 우편번호 조회 사용 가능 여부 (키 설정 확인) */
export function isPostalLookupConfigured(): boolean {
  return Boolean(process.env.KAKAO_REST_API_KEY)
}

type KakaoAddrPart = { zone_no?: string } | null
type KakaoDoc = {
  road_address: KakaoAddrPart
  address: KakaoAddrPart
}

/**
 * 상세주소 정제 — 원문 검색 실패 시 재시도용 쿼리 생성.
 * 카카오 address 검색은 도로명/지번 + 번지까지만 인식하므로 동/호·층·건물명·괄호를 제거한다.
 */
export function simplifyAddress(raw: string): string {
  const s = raw
    .replace(/\([^)]*\)/g, ' ') // (잠실동, 리센츠)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/,.*$/, ' ') // 콤마 이후 상세
    .replace(/\s+\S*\d+동\s*\d+호\S*/g, ' ') // 228동 1702호
    .replace(/\s+\d+층\S*/g, ' ') // 3층
    .replace(/\s+[A-Za-z]?\d+호\S*/g, ' ') // B102호 / 1101호
    .replace(/\s+/g, ' ')
    .trim()
  // 남은 문자열을 도로명(…로/길/대로 + 건물번호) 또는 지번(…동/리/가 + 번지)까지 절단.
  // 도로명에 숫자가 포함될 수 있음(송학로10길·상계로26길)을 감안해 \d*(?:번?길)? 허용.
  const m =
    s.match(/^(.*?(?:로|대로|길)\s*\d*(?:번?길)?\s*\d+(?:-\d+)?)/) ??
    s.match(/^(.*?(?:동|리|가)\s*\d+(?:-\d+)?)/)
  return m ? m[1] : s
}

class RateLimitError extends Error {
  readonly rateLimited = true
  constructor() {
    super('rate-limited')
  }
}

export function isRateLimitError(err: unknown): boolean {
  return err instanceof RateLimitError
}

async function queryOnce(query: string, apiKey: string): Promise<string | null> {
  const res = await fetch(`${KAKAO_ADDR_URL}?query=${encodeURIComponent(query)}&size=1`, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.status === 429) throw new RateLimitError()
  if (!res.ok) return null
  const data = (await res.json()) as { documents?: KakaoDoc[] }
  const doc = data.documents?.[0]
  return doc?.road_address?.zone_no || doc?.address?.zone_no || null
}

/**
 * 주소 1건의 우편번호 조회.
 * 원문 1차 → 0건이면 simplifyAddress 2차. 개별 실패(타임아웃/네트워크/0건)는 null.
 * 429(호출 한도)는 RateLimitError를 throw해 상위 배치가 중단하도록 한다.
 */
export async function lookupPostalCode(address: string, apiKey: string): Promise<string | null> {
  const trimmed = address.trim()
  if (!trimmed) return null
  try {
    const direct = await queryOnce(trimmed, apiKey)
    if (direct) return direct
    const simplified = simplifyAddress(trimmed)
    if (simplified && simplified !== trimmed) return await queryOnce(simplified, apiKey)
    return null
  } catch (err) {
    if (isRateLimitError(err)) throw err
    return null // 타임아웃/네트워크 개별 실패 → skip
  }
}
