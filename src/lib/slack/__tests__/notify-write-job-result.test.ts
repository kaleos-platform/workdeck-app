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

  // 워커가 타깃 루프 전에 죽으면 results 가 비어 있다 — 성공 문구가 나가면 안 된다.
  test('results 없는 FAILED — 잡 error 를 싣고 실패로 알린다', () => {
    const text = buildResultText({
      status: 'FAILED',
      results: [],
      error: '쿠팡 API 자격이 등록되어 있지 않습니다',
    })
    expect(text).toContain('실패')
    expect(text).toContain('자격이 등록되어 있지 않습니다')
    expect(text).not.toContain('✅')
  })

  test('results 없는 FAILED — error 도 없으면 기본 문구', () => {
    const text = buildResultText({ status: 'FAILED', results: [] })
    expect(text).toContain('워커 실행 중 중단')
  })

  test('대상 0건 SUCCEEDED 는 성공 문구를 쓰지 않는다', () => {
    const text = buildResultText({ status: 'SUCCEEDED', results: [] })
    expect(text).not.toContain('✅')
    expect(text).toContain('결과 없음')
  })
})
