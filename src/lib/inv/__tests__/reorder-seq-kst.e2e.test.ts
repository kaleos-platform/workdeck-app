/**
 * generatePlanNo — KST 기준 번호 생성 e2e.
 *
 * 발주 계획 번호(yyyyMMdd-NNN)가 서버 UTC가 아닌 KST 기준 날짜를 사용하는지 검증.
 * throwaway space/user로 격리. afterAll cascade로 0-state 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { generatePlanNo } from '@/lib/inv/reorder-seq'
import { getTodayStrKst } from '@/lib/date-range'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000f2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

async function cleanup() {
  await prisma.reorderPlan.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

d('generatePlanNo — KST 기준 발주 번호 생성 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E ReorderSeqKst', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-reorder-seq-kst@throwaway.test' },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('첫 번째 번호가 KST 오늘 날짜 기반 -001 패턴', async () => {
    const planNo = await prisma.$transaction(async (tx) => generatePlanNo(SPACE_ID, tx))

    // KST 오늘 날짜를 yyyyMMdd 형태로 계산 (하드코딩 금지)
    const todayPrefix = getTodayStrKst().replace(/-/g, '')
    expect(planNo).toMatch(new RegExp(`^${todayPrefix}-001$`))
  })

  test('실제 plan을 생성한 후 두 번째 번호가 -002로 증가', async () => {
    // 첫 번째 planNo를 받아 실제 plan 레코드를 생성해야 count가 올라감
    const firstPlanNo = await prisma.$transaction(async (tx) => generatePlanNo(SPACE_ID, tx))

    await prisma.reorderPlan.create({
      data: {
        id: `e2e-seq-kst-plan-01-${Date.now()}`,
        spaceId: SPACE_ID,
        planNo: firstPlanNo,
        windowDays: 30,
        createdById: USER_ID,
        totalSuggestedQty: 0,
        totalFinalQty: 0,
      },
    })

    // plan이 생성된 상태에서 다음 번호 조회 → -002
    const secondPlanNo = await prisma.$transaction(async (tx) => generatePlanNo(SPACE_ID, tx))

    const todayPrefix = getTodayStrKst().replace(/-/g, '')
    expect(secondPlanNo).toMatch(new RegExp(`^${todayPrefix}-002$`))
  })
})
