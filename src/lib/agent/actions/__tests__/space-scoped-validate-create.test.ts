/**
 * @jest-environment node
 */
const txn = jest.fn()
const cat = jest.fn()
const acc = jest.fn()
const prod = jest.fn()

jest.mock('@/lib/prisma', () => ({
  prisma: {
    finTransaction: { findFirst: (...a: unknown[]) => txn(...a) },
    finCategory: { findFirst: (...a: unknown[]) => cat(...a) },
    finAccount: { findFirst: (...a: unknown[]) => acc(...a) },
    invProduct: { findFirst: (...a: unknown[]) => prod(...a) },
  },
}))

import { financeActions } from '../finance'
import { sellerHubActions } from '../seller-hub'
import type { ActionExecContext } from '../types'

const ctx: ActionExecContext = {
  spaceId: 'space-a',
  actor: { type: 'system', id: 'workdeck-agent' },
  requesterUserId: null,
  workId: 'wk_test',
  decryptedCredentialIds: [],
}
const fin = (t: string) => financeActions.find((a) => a.actionType === t)!
const sh = (t: string) => sellerHubActions.find((a) => a.actionType === t)!
const found = { id: 'x' }

beforeEach(() => jest.resetAllMocks())

describe('제안 시점에 다른 Space 의 id 를 거부한다', () => {
  it('거래 재분류: 이 Space 의 거래·카테고리면 통과, 아니면 거부', async () => {
    txn.mockResolvedValue(found)
    cat.mockResolvedValue(found)
    await expect(
      fin('finance.transaction.reclassify').validateCreate!(ctx, {
        transactionId: 't1',
        categoryId: 'c1',
      })
    ).resolves.toBeUndefined()
    expect(txn).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1', spaceId: 'space-a' } })
    )

    txn.mockResolvedValue(null)
    await expect(
      fin('finance.transaction.reclassify').validateCreate!(ctx, {
        transactionId: 'other',
        categoryId: 'c1',
      })
    ).rejects.toThrow('거래를 찾을 수 없습니다')
  })

  it('분류 규칙: 다른 Space 카테고리·계좌는 거부, 계좌 생략은 카테고리만 확인', async () => {
    cat.mockResolvedValue(null)
    const rule = { matchKey: 'k', categoryId: 'c-other', matchType: 'EXACT' as const }
    await expect(fin('finance.classrule.create').validateCreate!(ctx, rule)).rejects.toThrow(
      '카테고리를 찾을 수 없습니다'
    )
    cat.mockResolvedValue(found)
    await expect(
      fin('finance.classrule.create').validateCreate!(ctx, rule)
    ).resolves.toBeUndefined()
    expect(acc).not.toHaveBeenCalled()
    acc.mockResolvedValue(null)
    await expect(
      fin('finance.classrule.create').validateCreate!(ctx, { ...rule, accountId: 'a-other' })
    ).rejects.toThrow('계좌를 찾을 수 없습니다')
  })

  it('발주 계획: 이 Space 의 활성 상품이 아니면 거부', async () => {
    prod.mockResolvedValue(null)
    await expect(
      sh('seller-hub.reorder.plan.create').validateCreate!(ctx, { productId: 'p-other' })
    ).rejects.toThrow('활성 상품을 찾을 수 없습니다')
    expect(prod).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p-other', spaceId: 'space-a', status: 'ACTIVE' } })
    )
  })
})
