/**
 * 재고 대조 이름 매칭 — soft-delete 된 옵션 제외 e2e.
 *
 * 배경: 생산 차수 등 참조가 있는 옵션은 삭제 시 hard delete 가 아니라 deletedAt 이 찍힌다.
 * 매처의 이름 fallback 이 이 옵션을 계속 후보로 잡으면, 사용자가 "지운" 옵션에 파일 행이
 * 다시 붙어 재고가 되살아난다(운영에서 60매 옵션이 이 경로로 4,529 를 받았다).
 *
 * 검증:
 *   1. soft-delete 된 옵션은 상품명+옵션명 정확 일치에서도 매칭되지 않는다 → file-only.
 *   2. 같은 옵션명을 가진 살아있는 다른 상품 옵션이 있으면 그쪽으로 매칭된다.
 *   3. file-only 추천 목록에도 삭제된 옵션은 나오지 않는다.
 *
 * throwaway Space/User, afterAll cascade 0-state 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { matchReconciliation } from '../reconciliation-matcher'
import type { ParseResult } from '../reconciliation-parser'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000d1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000d2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let locationId = ''
let deletedOptionId = ''
let liveOptionId = ''

async function cleanup() {
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invLocationProductMapItem.deleteMany({ where: { map: { spaceId: SPACE_ID } } })
  await prisma.invLocationProductMap.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

function parsed(productName: string, optionName: string, quantity: number): ParseResult {
  return {
    // stock_status_export 는 system-only 생성을 건너뛰어 검증이 단순해진다.
    format: 'stock_status_export',
    rows: [{ externalName: productName, externalOptionName: optionName, quantity }],
  }
}

d('재고 대조 이름 매칭 — 삭제된 옵션 제외 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E DeletedOption', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-recon-deleted-option@throwaway.test' },
    })

    const loc = await prisma.invStorageLocation.create({
      data: { spaceId: SPACE_ID, name: 'E2E 3PL', type: 'THIRD_PARTY', isActive: true },
    })
    locationId = loc.id

    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본' },
    })

    // 잘못 만들어진 상품 — 옵션을 soft-delete 한 상태
    const wrongProduct = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 개별포장', groupId: group.id, status: 'ACTIVE' },
    })
    const deleted = await prisma.invProductOption.create({
      data: { productId: wrongProduct.id, name: '60매', deletedAt: new Date() },
    })
    deletedOptionId = deleted.id

    // 실제로 써야 하는 상품 — 같은 옵션명, 살아있음
    const rightProduct = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 벌크', groupId: group.id, status: 'ACTIVE' },
    })
    const live = await prisma.invProductOption.create({
      data: { productId: rightProduct.id, name: '60매' },
    })
    liveOptionId = live.id
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('삭제된 옵션은 상품명+옵션명 일치에도 매칭되지 않는다', async () => {
    const res = await matchReconciliation(
      SPACE_ID,
      locationId,
      parsed('E2E 개별포장', '60매', 4529)
    )

    expect(res.matchedItems).toBe(0)
    expect(res.entries).toHaveLength(1)
    expect(res.entries[0].status).toBe('file-only')
  })

  it('살아있는 옵션에는 정상 매칭된다', async () => {
    const res = await matchReconciliation(SPACE_ID, locationId, parsed('E2E 벌크', '60매', 4529))

    expect(res.matchedItems).toBe(1)
    const entry = res.entries[0]
    expect(entry.status).toBe('matched-diff')
    if (entry.status === 'matched-diff' || entry.status === 'matched-equal') {
      expect(entry.optionId).toBe(liveOptionId)
    }
  })

  it('추천 목록에도 삭제된 옵션은 나오지 않는다', async () => {
    const res = await matchReconciliation(
      SPACE_ID,
      locationId,
      parsed('E2E 개별포장', '60매', 4529)
    )

    const entry = res.entries[0]
    expect(entry.status).toBe('file-only')
    if (entry.status === 'file-only') {
      expect(entry.suggestions.map((s) => s.optionId)).not.toContain(deletedOptionId)
    }
  })
})
