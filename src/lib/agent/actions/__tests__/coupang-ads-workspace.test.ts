/**
 * @jest-environment node
 */
const findFirstWorkspace = jest.fn()
const createReport = jest.fn()
const findFirstTask = jest.fn()

jest.mock('@/lib/prisma', () => ({
  prisma: {
    workspace: { findFirst: (...a: unknown[]) => findFirstWorkspace(...a) },
    analysisReport: { create: (...a: unknown[]) => createReport(...a) },
    executionTask: { findFirst: (...a: unknown[]) => findFirstTask(...a) },
  },
}))

import { coupangAdsActions } from '../coupang-ads'
import type { ActionExecContext } from '../types'

const ctx: ActionExecContext = {
  spaceId: 'space-a',
  actor: { type: 'system', id: 'workdeck-agent' },
  requesterUserId: null,
  workId: 'wk_test',
  decryptedCredentialIds: [],
}
const action = (t: string) => coupangAdsActions.find((a) => a.actionType === t)!

beforeEach(() => jest.clearAllMocks())

describe('coupang-ads 액션은 이 Space의 워크스페이스만 대상으로 한다', () => {
  it('다른 Space의 workspaceId면 analysis.trigger 생성·실행을 거부하고 리포트를 만들지 않는다', async () => {
    findFirstWorkspace.mockResolvedValue(null)
    const trigger = action('coupang-ads.analysis.trigger')
    const params = { workspaceId: 'ws-other', from: '2026-10-01', to: '2026-10-07' }

    await expect(trigger.validateCreate!(ctx, params)).rejects.toThrow('이 공간에 연결된')
    await expect(trigger.execute(ctx, params)).rejects.toThrow('이 공간에 연결된')
    expect(findFirstWorkspace).toHaveBeenCalledWith({
      where: { id: 'ws-other', spaceId: 'space-a' },
      select: { id: true },
    })
    expect(createReport).not.toHaveBeenCalled()
  })

  it('다른 Space의 workspaceId면 execution.approve도 태스크를 조회하지 않는다', async () => {
    findFirstWorkspace.mockResolvedValue(null)
    const approve = action('coupang-ads.execution.approve')

    await expect(approve.execute(ctx, { taskId: 't1', workspaceId: 'ws-other' })).rejects.toThrow(
      '이 공간에 연결된'
    )
    expect(findFirstTask).not.toHaveBeenCalled()
  })

  it('이 Space의 워크스페이스면 리포트를 만든다', async () => {
    findFirstWorkspace.mockResolvedValue({ id: 'ws-a' })
    createReport.mockResolvedValue({ id: 'r1' })

    await expect(
      action('coupang-ads.analysis.trigger').execute(ctx, {
        workspaceId: 'ws-a',
        from: '2026-10-01',
        to: '2026-10-07',
      })
    ).resolves.toEqual({ reportId: 'r1', status: 'PENDING' })
  })
})
