/** @jest-environment node */
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getActionDefinition } from '../registry'
import { deciderDenial, requiredDecisionRole } from '../decision-policy'

jest.mock('@/lib/prisma', () => ({
  prisma: { space: { findUnique: jest.fn() }, spaceMember: { findUnique: jest.fn() } },
}))
jest.mock('../registry', () => ({ getActionDefinition: jest.fn() }))

const getDef = getActionDefinition as jest.Mock
const findSpace = prisma.space.findUnique as jest.Mock
const findMember = prisma.spaceMember.findUnique as jest.Mock
const budgetDef = {
  actionType: 'test.budget.raise',
  requiredRole: 'ADMIN',
  paramsSchema: z.object({ amountKrw: z.number() }),
  spendKrw: (p: { amountKrw: number }) => p.amountKrw,
}
const action = (payload: unknown) => ({ spaceId: 's1', actionType: 'test.budget.raise', payload })

beforeEach(() => jest.clearAllMocks())

test('지출 필드가 없는 액션은 정의의 requiredRole', async () => {
  getDef.mockReturnValue({ requiredRole: 'ADMIN', paramsSchema: z.object({}) })
  await expect(requiredDecisionRole(action({}), 'approve')).resolves.toBe('ADMIN')
})

test('미등록 액션은 ADMIN', async () => {
  getDef.mockReturnValue(undefined)
  await expect(requiredDecisionRole(action({}), 'approve')).resolves.toBe('ADMIN')
})

test('승인 한도 초과 = 지출 제안 → OWNER', async () => {
  getDef.mockReturnValue(budgetDef)
  findSpace.mockResolvedValue({ approvalLimitKrw: 100_000 })
  await expect(requiredDecisionRole(action({ amountKrw: 100_001 }), 'approve')).resolves.toBe(
    'OWNER'
  )
})

test('승인 한도 이하 → 기본 역할', async () => {
  getDef.mockReturnValue(budgetDef)
  findSpace.mockResolvedValue({ approvalLimitKrw: 100_000 })
  await expect(requiredDecisionRole(action({ amountKrw: 100_000 }), 'approve')).resolves.toBe(
    'ADMIN'
  )
})

test('승인 한도 미설정(null)은 0 — 금액이 있으면 OWNER', async () => {
  getDef.mockReturnValue(budgetDef)
  findSpace.mockResolvedValue({ approvalLimitKrw: null })
  await expect(requiredDecisionRole(action({ amountKrw: 1 }), 'approve')).resolves.toBe('OWNER')
})

test('payload 해석 불가한 지출 액션은 보수적으로 OWNER', async () => {
  getDef.mockReturnValue(budgetDef)
  await expect(requiredDecisionRole(action({ amountKrw: 'x' }), 'approve')).resolves.toBe('OWNER')
})

test('거부는 금액과 무관하게 기본 역할', async () => {
  getDef.mockReturnValue(budgetDef)
  await expect(requiredDecisionRole(action({ amountKrw: 9e9 }), 'reject')).resolves.toBe('ADMIN')
})

describe('deciderDenial', () => {
  test('Space 구성원이 아니면(예: 레거시 slack:U… 문자열) 거부', async () => {
    getDef.mockReturnValue(undefined)
    findMember.mockResolvedValue(null)
    await expect(deciderDenial(action({}), 'slack:U1', 'approve')).resolves.toContain('구성원')
    expect(findMember.mock.calls[0][0].where).toEqual({
      spaceId_userId: { spaceId: 's1', userId: 'slack:U1' },
    })
  })

  test('MEMBER 는 ADMIN 액션을 결정할 수 없다', async () => {
    getDef.mockReturnValue(undefined)
    findMember.mockResolvedValue({ role: 'MEMBER' })
    await expect(deciderDenial(action({}), 'u', 'approve')).resolves.toContain('ADMIN')
  })

  test('지출 제안을 ADMIN 이 승인 → OWNER 안내', async () => {
    getDef.mockReturnValue(budgetDef)
    findSpace.mockResolvedValue({ approvalLimitKrw: 0 })
    findMember.mockResolvedValue({ role: 'ADMIN' })
    await expect(deciderDenial(action({ amountKrw: 1 }), 'u', 'approve')).resolves.toContain(
      '지출 제안'
    )
  })

  test('OWNER 는 지출 제안 승인 가능, ADMIN 은 일반 액션 승인 가능', async () => {
    getDef.mockReturnValue(budgetDef)
    findSpace.mockResolvedValue({ approvalLimitKrw: 0 })
    findMember.mockResolvedValue({ role: 'OWNER' })
    await expect(deciderDenial(action({ amountKrw: 1 }), 'u', 'approve')).resolves.toBeNull()
    getDef.mockReturnValue(undefined)
    findMember.mockResolvedValue({ role: 'ADMIN' })
    await expect(deciderDenial(action({}), 'u', 'approve')).resolves.toBeNull()
  })
})
