import { excludeRemoveKeyword } from '@/lib/coupang-ads/analysis-suggestions'
import type { Suggestion } from '@/types/analysis'

const s = (type: string) =>
  ({ type, priority: 'HIGH', campaignId: 'c', target: 't', reason: 'r' }) as Suggestion

describe('excludeRemoveKeyword', () => {
  it('REMOVE_KEYWORD 만 제외한다', () => {
    expect(excludeRemoveKeyword([s('REMOVE_KEYWORD'), s('ADJUST_BID')]).map((x) => x.type)).toEqual(
      ['ADJUST_BID']
    )
  })
  it('제거 제안만 있으면 빈 배열, null 도 안전', () => {
    expect(excludeRemoveKeyword([s('REMOVE_KEYWORD')])).toEqual([])
    expect(excludeRemoveKeyword(undefined)).toEqual([])
  })
})
