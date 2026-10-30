/**
 * 옵션 단종 — 재고 현황 노출 규칙 e2e.
 *
 *   1. 단종 + 재고 0 → 숨김 (includeDiscontinued 면 보임)
 *   2. 단종 + 재고 있음 → 보임, optionStatus=DISCONTINUED
 *   3. 단종 + 재고 음수 → 보임 (정리 필요)
 *   4. 판매중 + 재고 0 → 보임 (품절 신호)
 *
 * throwaway Space, afterAll cascade 0-state 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { queryStockStatus } from '../queries'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

const ids: Record<string, string> = {}

async function cleanup() {
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

d('옵션 단종 재고 현황 노출 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E OptionStatus', type: 'PERSONAL' },
    })
    const loc = await prisma.invStorageLocation.create({
      data: { spaceId: SPACE_ID, name: 'E2E 사무실', type: 'OWN', isActive: true },
    })
    const group = await prisma.invProductGroup.create({ data: { spaceId: SPACE_ID, name: '기본' } })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 단종상품', groupId: group.id, status: 'ACTIVE' },
    })
    const seed: [string, 'ACTIVE' | 'DISCONTINUED', number | null][] = [
      ['disc-zero', 'DISCONTINUED', null],
      ['disc-stock', 'DISCONTINUED', 5],
      ['disc-neg', 'DISCONTINUED', -2],
      ['active-zero', 'ACTIVE', null],
    ]
    for (const [name, status, qty] of seed) {
      const o = await prisma.invProductOption.create({
        data: { productId: product.id, name, status },
      })
      ids[name] = o.id
      if (qty !== null) {
        await prisma.invStockLevel.create({
          data: { spaceId: SPACE_ID, optionId: o.id, locationId: loc.id, quantity: qty },
        })
      }
    }
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('단종+재고 0 만 숨기고, includeDiscontinued 면 모두 보인다', async () => {
    const res = await queryStockStatus(SPACE_ID)
    const names = new Set(res.matrix.rows.map((r) => r.optionName))
    expect(names.has('disc-zero')).toBe(false)
    expect(names.has('disc-stock')).toBe(true)
    expect(names.has('disc-neg')).toBe(true)
    expect(names.has('active-zero')).toBe(true)
    expect(res.matrix.rows.find((r) => r.optionName === 'disc-stock')?.optionStatus).toBe(
      'DISCONTINUED'
    )

    const all = await queryStockStatus(SPACE_ID, { includeDiscontinued: true })
    expect(all.matrix.rows.map((r) => r.optionName)).toContain('disc-zero')
  })
})
