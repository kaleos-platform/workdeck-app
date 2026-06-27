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
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { seedFinanceCategories, ensureFinanceSeeded } from '@/lib/finance/kifrs-seed'

const p = prisma as unknown as {
  finCategory: { findFirst: jest.Mock; create: jest.Mock; count: jest.Mock }
  finClassRule: { findFirst: jest.Mock; create: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()
  // 미존재 → 항상 create 경로. 부모-자식 parentId 추적을 위해 이름 기반 고유 id 반환.
  p.finCategory.findFirst.mockResolvedValue(null)
  p.finCategory.create.mockImplementation(async (args: { data: { name: string } }) => ({
    id: `cat:${args.data.name}`,
  }))
  p.finClassRule.findFirst.mockResolvedValue(null)
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

describe('isSystem/parentId 구조 (제거 가능 기본값 가드)', () => {
  type CreatedData = {
    name: string
    parentId: string | null
    isSystem: boolean
    type: string
    groupLabel: string | null
  }

  async function seedAndCollect(): Promise<Map<string, CreatedData>> {
    await seedFinanceCategories('space-1')
    const calls = p.finCategory.create.mock.calls.map((c) => (c[0] as { data: CreatedData }).data)
    return new Map(calls.map((d) => [d.name, d]))
  }

  test('루트만 isSystem=true(보호), 대분류·수입/지출 리프는 false(편집·삭제 가능)', async () => {
    const m = await seedAndCollect()

    // 루트 = 보호, parentId 없음
    expect(m.get('지출')).toMatchObject({ isSystem: true, parentId: null })
    expect(m.get('수입')).toMatchObject({ isSystem: true, parentId: null })

    // 대분류(그룹) = 편집/삭제 가능(이름변경·추가/삭제)
    expect(m.get('물류·배송')?.isSystem).toBe(false)
    expect(m.get('인건비')?.isSystem).toBe(false)

    // 수입/지출 운영 항목(리프) = 편집/삭제 가능
    expect(m.get('택배비')?.isSystem).toBe(false)
    expect(m.get('온라인 판매정산')?.isSystem).toBe(false)
  })

  test('TRANSFER 리프만 보호(net-off), 자산·부채 리프는 편집 가능(계좌 관리 화면)', async () => {
    const m = await seedAndCollect()
    // net-off 불변식 보호
    expect(m.get('계좌간 이체')?.isSystem).toBe(true)
    expect(m.get('신용카드 대금 납부')?.isSystem).toBe(true)
    // 자산/부채 리프 = 편집 가능
    expect(m.get('현금및현금성자산')?.isSystem).toBe(false)
    expect(m.get('매입채무')?.isSystem).toBe(false)
  })

  test('운영 항목의 parentId가 소속 대분류를 가리킨다(2단계 트리)', async () => {
    const m = await seedAndCollect()
    // 택배비 → 물류·배송 → 지출
    expect(m.get('택배비')?.parentId).toBe('cat:물류·배송')
    expect(m.get('물류·배송')?.parentId).toBe('cat:지출')
  })

  test('리프에 고정/변동 원가성격이 groupLabel로 들어간다', async () => {
    const m = await seedAndCollect()
    expect(m.get('급여')?.groupLabel).toBe('고정')
    expect(m.get('택배비')?.groupLabel).toBe('변동')
    // 대분류 자체엔 고정/변동 없음
    expect(m.get('물류·배송')?.groupLabel ?? null).toBeNull()
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
