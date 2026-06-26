/** @jest-environment node */
/**
 * 재무 시드 정책 단위 테스트 (prisma mock — DB 불필요).
 * - seedFinanceCategories 기본값 = 카테고리만(자동분류 규칙 미생성, 사용자 직접 구축)
 * - withRules:true = 규칙도 시드(활성화 전체 시드 경로 보존)
 * - ensureFinanceSeeded = 카테고리 0이면 시드, 있으면 no-op(멱등)
 */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    finCategory: {
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    finClassRule: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { seedFinanceCategories, ensureFinanceSeeded } from '@/lib/finance/kifrs-seed'

const p = prisma as unknown as {
  finCategory: { findFirst: jest.Mock; create: jest.Mock; count: jest.Mock }
  finClassRule: { findUnique: jest.Mock; create: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()
  // 미존재 → 항상 create 경로
  p.finCategory.findFirst.mockResolvedValue(null)
  p.finCategory.create.mockResolvedValue({ id: 'cat' })
  p.finClassRule.findUnique.mockResolvedValue(null)
  p.finClassRule.create.mockResolvedValue({ id: 'rule' })
})

describe('seedFinanceCategories', () => {
  test('기본값: 카테고리만 시드하고 자동분류 규칙은 만들지 않는다', async () => {
    await seedFinanceCategories('space-1')
    expect(p.finCategory.create).toHaveBeenCalled()
    expect(p.finClassRule.create).not.toHaveBeenCalled()
  })

  test('withRules:true: 카테고리 + 규칙 모두 시드', async () => {
    await seedFinanceCategories('space-1', { withRules: true })
    expect(p.finCategory.create).toHaveBeenCalled()
    expect(p.finClassRule.create).toHaveBeenCalled()
  })
})

describe('ensureFinanceSeeded', () => {
  test('카테고리 0이면 기본 시드(카테고리만) 실행', async () => {
    p.finCategory.count.mockResolvedValue(0)
    await ensureFinanceSeeded('space-1')
    expect(p.finCategory.create).toHaveBeenCalled()
    expect(p.finClassRule.create).not.toHaveBeenCalled()
  })

  test('카테고리가 있으면 no-op(멱등) — 추가 생성 없음', async () => {
    p.finCategory.count.mockResolvedValue(27)
    await ensureFinanceSeeded('space-1')
    expect(p.finCategory.create).not.toHaveBeenCalled()
  })
})
