/** @jest-environment node */
// 발주 계획 액션 — 자동 실행이면 memo 앞에 「[에이전트 이름 자동 생성]」을 붙이고, 수동 승인은 그대로 둔다.
import { runReorderPlanRequest } from '@/lib/inv/reorder-engine/run-plan-request'
import { sellerHubActions } from '../seller-hub'

jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/inv/reorder-engine/run-plan-request', () => ({ runReorderPlanRequest: jest.fn() }))
jest.mock('@/lib/domain', () => ({ buildAppUrl: (p: string) => p }))

const run = runReorderPlanRequest as jest.Mock
const def = sellerHubActions.find((a) => a.actionType === 'seller-hub.reorder.plan.create')!
const base = {
  spaceId: 'sp1',
  actor: { type: 'agent' as const, id: 'ag1' },
  requesterUserId: null,
  workId: 'w',
  deciderId: 'admin1',
  decryptedCredentialIds: [],
}

beforeEach(() => {
  run.mockReset()
  run.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ planId: 'pl1', ownLocations: [], items: [] }),
  }))
})

const createBody = () => run.mock.calls.map((c) => c[1]).find((b) => !b.dryRun)

test('자동 실행 → memo 앞에 에이전트 이름 표시', async () => {
  await def.execute(
    { ...base, autoExecuted: true, actorName: '에밀리' },
    { productId: 'p1', memo: '급함' }
  )
  expect(createBody().memo).toBe('[에밀리 자동 생성] 급함')
})

test('자동 실행 + 이름 없음 + memo 없음 → 기본 표시', async () => {
  await def.execute({ ...base, autoExecuted: true }, { productId: 'p1' })
  expect(createBody().memo).toBe('[에이전트 자동 생성] ')
})

test('수동 승인 → memo 그대로', async () => {
  await def.execute(base, { productId: 'p1', memo: '급함' })
  expect(createBody().memo).toBe('급함')
})
