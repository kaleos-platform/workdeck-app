/**
 * 재고 대조 제외 SKU e2e.
 *
 * 핵심 검증:
 *   1. 제외한 코드 + 파일 수량 0 → 'excluded' (미매칭으로 세지 않는다)
 *   2. 제외한 코드 + 파일 수량 > 0 → 'file-only' + excludedWithStock (재고가 생기면 다시 드러난다)
 *   3. 제외한 코드라도 매핑이 있으면 매핑이 우선한다
 *   4. 저장된 'excluded' 스냅샷도 해제하면 'file-only' 로 돌아간다 (상세 GET 재해석 경로)
 *
 * throwaway Space(고유 hex UUID), afterAll cascade 0-state 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { matchReconciliation, type MatchEntry } from '../reconciliation-matcher'
import { applyExclusions } from '../reconciliation-exclusion'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f1'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let locationId = ''
let optionId = ''

async function cleanup() {
  await prisma.invReconExcludedCode.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invLocationProductMapItem.deleteMany({ where: { map: { spaceId: SPACE_ID } } })
  await prisma.invLocationProductMap.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

const row = (externalCode: string, quantity: number) => ({
  externalCode,
  externalName: `판매중지 ${externalCode}`,
  externalOptionName: '옵션',
  quantity,
})

d('재고 대조 제외 SKU (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E ReconExclude', type: 'PERSONAL' },
    })
    const loc = await prisma.invStorageLocation.create({
      data: { spaceId: SPACE_ID, name: 'E2E 로켓그로스', type: 'THIRD_PARTY', isActive: true },
    })
    locationId = loc.id
    const group = await prisma.invProductGroup.create({ data: { spaceId: SPACE_ID, name: '기본' } })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 제외상품', groupId: group.id, status: 'ACTIVE' },
    })
    optionId = (
      await prisma.invProductOption.create({ data: { productId: product.id, name: 'A' } })
    ).id

    // EX-ZERO·EX-STOCK·EX-MAPPED 제외, EX-MAPPED 는 매핑도 있음, EX-OPEN 은 제외 안 함
    await prisma.invReconExcludedCode.createMany({
      data: ['EX-ZERO', 'EX-STOCK', 'EX-MAPPED'].map((externalCode) => ({
        spaceId: SPACE_ID,
        locationId,
        externalCode,
      })),
    })
    const map = await prisma.invLocationProductMap.create({
      data: { spaceId: SPACE_ID, locationId, externalCode: 'EX-MAPPED' },
    })
    await prisma.invLocationProductMapItem.create({
      data: { mapId: map.id, optionId, quantity: 1 },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('수량 0 은 excluded, 수량이 생기면 file-only+excludedWithStock, 매핑이 제외보다 우선', async () => {
    const { entries } = await matchReconciliation(SPACE_ID, locationId, {
      format: 'coupang_health',
      rows: [row('EX-ZERO', 0), row('EX-STOCK', 2), row('EX-MAPPED', 0), row('EX-OPEN', 0)],
    })
    const byCode = new Map(
      entries
        .filter((e) => 'row' in e)
        .map((e) => [(e as { row: { externalCode: string } }).row.externalCode, e])
    )

    expect(byCode.get('EX-ZERO')?.status).toBe('excluded')
    const stocked = byCode.get('EX-STOCK')
    expect(stocked?.status).toBe('file-only')
    expect(stocked?.status === 'file-only' && stocked.excludedWithStock).toBe(true)
    expect(byCode.get('EX-MAPPED')?.status).toBe('matched-equal')
    const open = byCode.get('EX-OPEN')
    expect(open?.status).toBe('file-only')
    expect(open?.status === 'file-only' && open.excludedWithStock).toBeFalsy()
  })

  it('저장된 excluded 는 해제하면 file-only 로 돌아간다', async () => {
    const stored: MatchEntry[] = [{ status: 'excluded', row: row('EX-ZERO', 0), locationId }]
    expect((await applyExclusions(stored, locationId))[0].status).toBe('excluded')

    await prisma.invReconExcludedCode.deleteMany({
      where: { locationId, externalCode: 'EX-ZERO' },
    })
    const after = await applyExclusions(stored, locationId)
    expect(after[0].status).toBe('file-only')
  })
})
