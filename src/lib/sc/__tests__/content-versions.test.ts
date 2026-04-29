// Phase 2 Unit 16 — 콘텐츠 버전 히스토리 순수 로직 단위 테스트
// Prisma 의존 함수(snapshotContent, rollbackContent)는 테스트하지 않음.
// nextVersionNumber 순수 함수만 검증.

import { nextVersionNumber } from '../content-versions'

describe('nextVersionNumber', () => {
  it('버전이 없으면 1 반환', () => {
    expect(nextVersionNumber([])).toBe(1)
  })

  it('버전 1개이면 2 반환', () => {
    expect(nextVersionNumber([1])).toBe(2)
  })

  it('최대 버전 번호 기준으로 +1', () => {
    expect(nextVersionNumber([1, 2, 3])).toBe(4)
  })

  it('순서가 뒤섞여도 MAX 기준으로 +1', () => {
    expect(nextVersionNumber([3, 1, 5, 2])).toBe(6)
  })

  it('단조 증가 보장 — 이미 큰 번호가 있어도 정확히 +1', () => {
    expect(nextVersionNumber([10])).toBe(11)
    expect(nextVersionNumber([99, 100])).toBe(101)
  })
})
