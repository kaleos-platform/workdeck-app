// @jest-environment node
import { buildResultText } from '../notify-write-job-result'

describe('buildResultText', () => {
  test('전건 성공', () => {
    const text = buildResultText({
      status: 'SUCCEEDED',
      results: [
        { listingName: 'A', ok: true, error: null },
        { listingName: 'B', ok: true, error: null },
      ],
    })
    expect(text).toContain('2건 중 2건 반영')
  })

  test('부분 실패 — 쿠팡 문구를 그대로 싣는다', () => {
    const text = buildResultText({
      status: 'PARTIAL',
      results: [
        { listingName: 'A', ok: true, error: null },
        {
          listingName: 'B',
          ok: false,
          error: '쿠팡 쓰기 실패: 변경전 판매가의 최대 50% 인하까지 변경가능합니다.',
        },
      ],
    })
    expect(text).toContain('2건 중 1건 실패')
    expect(text).toContain('최대 50% 인하')
    expect(text).toContain('B')
  })

  test('전건 실패', () => {
    const text = buildResultText({
      status: 'FAILED',
      results: [{ listingName: 'A', ok: false, error: '쿠팡 쓰기 실패: 삭제된 상품' }],
    })
    expect(text).toContain('실패')
  })
})
