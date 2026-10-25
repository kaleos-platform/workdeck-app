import { formatRank, formatRankChange, formatRankNumber, sourceShortLabel } from '../rank-format'

const ranked = (rank: number) => ({ date: '2026-10-19', status: 'RANKED' as const, rank })
const out = { date: '2026-10-19', status: 'NOT_IN_TOP100' as const, rank: null }

describe('rank-format', () => {
  it('상태별 순위 문구', () => {
    expect(formatRank(ranked(12))).toBe('12위')
    expect(formatRank(out)).toBe('100위 밖')
    expect(formatRank({ status: 'FAILED', rank: null })).toBe('측정 실패')
    expect(formatRank({ status: 'SKIPPED', rank: null })).toBe('미측정')
    expect(formatRank(null)).toBe('—')
  })

  it('101 은 100위 밖', () => {
    expect(formatRankNumber(101)).toBe('100위 밖')
    expect(formatRankNumber(7)).toBe('7위')
    expect(formatRankNumber(null)).toBe('—')
  })

  it('검색처 약칭', () => {
    expect(sourceShortLabel('NAVER_SHOPPING')).toBe('네')
    expect(sourceShortLabel('COUPANG')).toBe('쿠')
  })

  it('7일 변화: 순위 숫자가 줄면 ▲', () => {
    expect(formatRankChange(ranked(5), ranked(12))).toBe('▲7')
    expect(formatRankChange(ranked(20), ranked(12))).toBe('▼8')
    expect(formatRankChange(ranked(12), ranked(12))).toBe('–')
  })

  it('진입·이탈·비교 불가', () => {
    expect(formatRankChange(ranked(30), out)).toBe('진입')
    expect(formatRankChange(out, ranked(30))).toBe('이탈')
    expect(formatRankChange(out, out)).toBe('')
    expect(formatRankChange(ranked(3), null)).toBe('')
    expect(formatRankChange(ranked(3), { status: 'FAILED', rank: null })).toBe('')
  })
})
