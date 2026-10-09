import { PERIOD_CONFIRM_LABEL } from '../inventory-collector'

describe('판매분석 기간 확인 버튼 라벨', () => {
  it('신·구 문구 모두 매칭한다', () => {
    expect(PERIOD_CONFIRM_LABEL.test("'10.07 (수) 선택")).toBe(true) // 2026-10-08~
    expect(PERIOD_CONFIRM_LABEL.test("'06.05 (금)' 선택 완료")).toBe(true) // 기존
    expect(PERIOD_CONFIRM_LABEL.test("'10.01 ~ '10.07 선택")).toBe(true) // 구간
  })
  it('프리셋·다른 선택 버튼과 겹치지 않는다', () => {
    for (const t of ['어제', '최근 7일', '초기화', '옵션 선택', '날짜 선택', '선택 완료']) {
      expect(PERIOD_CONFIRM_LABEL.test(t)).toBe(false)
    }
  })
})
