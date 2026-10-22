// 키워드 순위 표시 규칙 — 보드·칩 배지·효과 패널이 함께 쓴다(순수 함수, 서버 의존 없음).

export type RankSource = 'NAVER_SHOPPING' | 'COUPANG'
export type RankStatus = 'RANKED' | 'NOT_IN_TOP100' | 'FAILED' | 'SKIPPED'

export type RankSnapshot = { date: string; status: RankStatus; rank: number | null }

/** 효과 패널의 중앙값 등에서 "100위 밖"을 나타내는 값 */
export const OUT_OF_TOP100_RANK = 101

const SOURCE_SHORT: Record<RankSource, string> = { NAVER_SHOPPING: '네', COUPANG: '쿠' }
const SOURCE_LONG: Record<RankSource, string> = { NAVER_SHOPPING: '네이버쇼핑', COUPANG: '쿠팡' }

export function sourceShortLabel(source: RankSource): string {
  return SOURCE_SHORT[source]
}

export function sourceLongLabel(source: RankSource): string {
  return SOURCE_LONG[source]
}

export function formatRank(
  snap: { status: RankStatus; rank: number | null } | null | undefined
): string {
  if (!snap) return '—'
  switch (snap.status) {
    case 'RANKED':
      return snap.rank == null ? '—' : `${snap.rank}위`
    case 'NOT_IN_TOP100':
      return '100위 밖'
    case 'FAILED':
      return '측정 실패'
    case 'SKIPPED':
      return '미측정'
  }
}

/** 효과 패널용 — 순위 숫자(101 = 100위 밖, null = 데이터 없음) */
export function formatRankNumber(rank: number | null | undefined): string {
  if (rank == null) return '—'
  return rank >= OUT_OF_TOP100_RANK ? '100위 밖' : `${rank}위`
}

/** 7일 전 대비 변화 문구. 비교할 수 없으면 빈 문자열. */
export function formatRankChange(
  latest: { status: RankStatus; rank: number | null } | null | undefined,
  prev7: { status: RankStatus; rank: number | null } | null | undefined
): string {
  if (!latest || !prev7) return ''
  if (latest.status === 'RANKED' && prev7.status === 'RANKED') {
    if (latest.rank == null || prev7.rank == null) return ''
    const diff = prev7.rank - latest.rank
    if (diff > 0) return `▲${diff}`
    if (diff < 0) return `▼${-diff}`
    return '–'
  }
  if (latest.status === 'RANKED' && prev7.status === 'NOT_IN_TOP100') return '진입'
  if (latest.status === 'NOT_IN_TOP100' && prev7.status === 'RANKED') return '이탈'
  return ''
}
