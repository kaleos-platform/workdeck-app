/**
 * 채널별 상품명 글자수 가이드 (공백 포함).
 * 저장은 200자까지 허용하되, 초과 시 UI에서 경고만.
 * 데이터는 채널명에 prefix가 포함되면 적용되도록 keyword로 매칭한다.
 */

export type ChannelNameLimit = {
  searchName?: number // 검색용 상품명 상한 (≈리스팅 상단 노출)
  displayName?: number // 노출용 상품명 상한 (≈상세 타이틀)
}

const GUIDES: Array<{ keyword: string; limit: ChannelNameLimit }> = [
  { keyword: '쿠팡', limit: { searchName: 100, displayName: 100 } },
  { keyword: '스마트스토어', limit: { searchName: 50, displayName: 50 } },
  { keyword: '네이버', limit: { searchName: 50, displayName: 50 } },
  { keyword: '29CM', limit: { searchName: 40, displayName: 40 } },
  { keyword: '무신사', limit: { searchName: 30, displayName: 40 } },
  { keyword: '에이블리', limit: { searchName: 40, displayName: 40 } },
  { keyword: '지그재그', limit: { searchName: 40, displayName: 40 } },
  { keyword: '오늘의집', limit: { searchName: 40, displayName: 40 } },
]

export function getChannelNameLimit(channelName: string | null | undefined): ChannelNameLimit {
  if (!channelName) return {}
  const lower = channelName.toLowerCase()
  for (const g of GUIDES) {
    if (lower.includes(g.keyword.toLowerCase())) return g.limit
  }
  return {}
}

/**
 * 공백 포함 글자 수 (한글·영문 섞여도 JS `.length` 기준으로 충분 — emoji 같은 surrogate 쌍은 이 도메인에서 고려하지 않음).
 */
export function countChars(value: string): number {
  return value.length
}
