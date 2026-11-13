/** @jest-environment node */
import { settlePlanAccuracy } from '../settle-accuracy'
import { prisma } from '@/lib/prisma'
import { computeAccuracy } from '../accuracy'

jest.mock('@/lib/prisma', () => ({
  prisma: { reorderPlan: { findUnique: jest.fn() }, reorderPlanAccuracy: { upsert: jest.fn() } },
}))
jest.mock('../accuracy', () => ({
  computeAccuracy: jest.fn(),
  computeModelWape: jest.fn().mockReturnValue({ MA30: 0.2 }),
}))

const item = (id: string, forecastModel: string) => ({
  id,
  optionId: id,
  leadTimeDays: 1,
  finalQty: 10,
  dailyAvgForecast: 1,
  safetyStockQty: 0,
  confirmedLeadTimeDays: null,
  confirmedFinalQty: null,
  confirmedDailyAvgForecast: null,
  confirmedSafetyStockQty: null,
  snapshotSource: null,
  modelForecasts: null,
  forecastModel,
})

it('MANUAL 항목은 bias=0(보정 없음)으로 저장하고 modelWape 는 그대로 계산한다', async () => {
  ;(prisma.reorderPlan.findUnique as jest.Mock).mockResolvedValue({
    id: 'pl',
    spaceId: 's',
    status: 'FINALIZED',
    confirmedAt: new Date('2020-01-01'),
    supersededAt: null,
    items: [item('o-manual', 'MANUAL'), item('o-auto', 'MA30')],
  })
  ;(computeAccuracy as jest.Mock).mockResolvedValue({
    actualOutbound: 5,
    forecastOutbound: 10,
    wape: 1,
    bias: 1,
    stockoutDays: 0,
    overstockDays: 0,
  })
  const r = await settlePlanAccuracy('pl', 's')
  const calls = (prisma.reorderPlanAccuracy.upsert as jest.Mock).mock.calls.map((c) => c[0])
  const byOpt = (o: string) => calls.find((c) => c.where.planId_optionId.optionId === o)
  expect(byOpt('o-manual').create.bias).toBe(0)
  expect(byOpt('o-manual').create.modelWape).toEqual({ MA30: 0.2 })
  expect(byOpt('o-auto').create.bias).toBe(1)
  expect(r.ok && r.accuracies.find((a) => a.optionId === 'o-manual')?.bias).toBe(0)
})
