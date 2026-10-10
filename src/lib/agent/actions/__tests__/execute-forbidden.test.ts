/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { deciderDenial } from '../decision-policy'
import { approveAndExecute, rejectAction } from '../execute'

jest.mock('@/lib/prisma', () => ({
  prisma: { agentPendingAction: { findUnique: jest.fn(), updateMany: jest.fn() } },
}))
jest.mock('@/lib/billing/entitlement', () => ({
  assertDeckWritable: jest.fn().mockResolvedValue(null),
}))
jest.mock('../registry', () => ({ getActionDefinition: jest.fn() }))
jest.mock('../decision-policy', () => ({ deciderDenial: jest.fn() }))

const p = prisma.agentPendingAction as unknown as { findUnique: jest.Mock; updateMany: jest.Mock }
const denial = deciderDenial as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  p.findUnique.mockResolvedValue({
    status: 'PENDING',
    spaceId: 's1',
    deckKey: 'finance',
    actionType: 'x',
    payload: {},
  })
})

test('결정 권한이 없으면 FORBIDDEN, 상태 전이 없음(승인)', async () => {
  denial.mockResolvedValue('승인 권한이 없습니다(ADMIN 이상 필요).')
  await expect(approveAndExecute('a1', 'u-member')).resolves.toEqual({
    ok: false,
    status: 'FORBIDDEN',
    message: '승인 권한이 없습니다(ADMIN 이상 필요).',
  })
  expect(p.updateMany).not.toHaveBeenCalled()
  expect(denial).toHaveBeenCalledWith(
    expect.objectContaining({ spaceId: 's1' }),
    'u-member',
    'approve'
  )
})

test('결정 권한이 없으면 FORBIDDEN, 상태 전이 없음(거부)', async () => {
  denial.mockResolvedValue('이 공간의 구성원만 결정할 수 있습니다.')
  await expect(rejectAction('a1', 'slack:U1')).resolves.toMatchObject({ status: 'FORBIDDEN' })
  expect(p.updateMany).not.toHaveBeenCalled()
})
