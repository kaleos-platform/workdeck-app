/** @jest-environment node */
// 승인 실행 감사의 실패 분기 — 감사 행을 못 만들면 실행하지 않고, 결과 기록 실패는 재실행·FAILED로 바꾸지 않는다.
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { finishToolAudit, startToolAudit } from '@/lib/agent/audit'
import { getActionDefinition } from '../registry'
import { ACTION_INTERNAL_ERROR, approveAndExecute } from '../execute'
import { Prisma } from '@/generated/prisma/client'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentPendingAction: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  },
}))
jest.mock('@/lib/billing/entitlement', () => ({
  assertDeckWritable: jest.fn().mockResolvedValue(null),
}))
jest.mock('../decision-policy', () => ({ deciderDenial: jest.fn().mockResolvedValue(null) }))
jest.mock('../registry', () => ({ getActionDefinition: jest.fn() }))
jest.mock('@/lib/agent/audit', () => ({
  startToolAudit: jest.fn(),
  finishToolAudit: jest.fn(),
  maskSecrets: jest.requireActual('@/lib/agent/audit').maskSecrets,
}))

const p = prisma.agentPendingAction as unknown as {
  findUnique: jest.Mock
  updateMany: jest.Mock
  update: jest.Mock
}
const execute = jest.fn(async () => ({ done: true }))

beforeEach(() => {
  jest.clearAllMocks()
  p.findUnique.mockResolvedValue({
    status: 'PENDING',
    spaceId: 's1',
    deckKey: 'finance',
    actionType: 'x',
    payload: {},
    actorType: 'agent',
    actorId: 'ag1',
    requesterUserId: 'u-req',
    workId: 'wk_1',
  })
  p.updateMany.mockResolvedValue({ count: 1 })
  p.update.mockReset().mockResolvedValue({})
  ;(getActionDefinition as jest.Mock).mockReturnValue({
    actionType: 'x',
    paramsSchema: z.object({}),
    execute,
  })
  ;(startToolAudit as jest.Mock).mockResolvedValue('aud1')
})

test('감사 시작 기록 실패 → 실행하지 않고 FAILED', async () => {
  ;(startToolAudit as jest.Mock).mockRejectedValue(
    new Error('감사 기록을 남길 수 없어 실행하지 않았습니다')
  )
  await expect(approveAndExecute('a1', 'u-decider')).resolves.toMatchObject({
    status: 'FAILED',
    error: '감사 기록을 남길 수 없어 실행하지 않았습니다',
  })
  expect(execute).not.toHaveBeenCalled()
  expect(p.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
  )
})

test('감사 시작 기록의 Prisma 오류 → 일반 문구로 FAILED(쿼리 원문 미노출)', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  ;(startToolAudit as jest.Mock).mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError(
      'Invalid `prisma.toolAudit.create()` {"secret":"s3"}',
      {
        code: 'P2002',
        clientVersion: 'test',
      }
    )
  )
  await expect(approveAndExecute('a1', 'u-decider')).resolves.toEqual({
    ok: false,
    status: 'FAILED',
    error: ACTION_INTERNAL_ERROR,
  })
  expect(execute).not.toHaveBeenCalled()
})

test('감사 행은 원래 행위자·요청자·workId + 별도 승인자로 실행 전에 만든다', async () => {
  await approveAndExecute('a1', 'u-decider')
  expect(startToolAudit).toHaveBeenCalledWith(
    expect.objectContaining({
      actor: { type: 'agent', id: 'ag1' },
      requesterUserId: 'u-req',
      workId: 'wk_1',
      tool: 'action:x',
      actionId: 'a1',
      deciderUserId: 'u-decider',
    })
  )
  expect((startToolAudit as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
    execute.mock.invocationCallOrder[0]
  )
})

test('실행 후 EXECUTED 갱신 실패 → 한 번만 실행, FAILED로 덮지 않고 예외는 호출자에게', async () => {
  p.update.mockRejectedValue(new Error('db down'))
  await expect(approveAndExecute('a1', 'u-decider')).rejects.toThrow('db down')
  expect(execute).toHaveBeenCalledTimes(1)
  expect(finishToolAudit).toHaveBeenCalledWith('aud1', expect.objectContaining({ outcome: 'ok' }))
  expect(p.update).toHaveBeenCalledTimes(1)
  expect(p.update.mock.calls[0][0].data.status).toBe('EXECUTED')
})

test('Prisma 오류 → 승인 UI·Slack에는 일반 문구, 쿼리·인자 원문은 남기지 않는다', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  execute.mockRejectedValueOnce(
    new Prisma.PrismaClientKnownRequestError('Invalid `prisma.x.update()` where {"secret":"s3"}', {
      code: 'P2025',
      clientVersion: 'test',
    })
  )
  await expect(approveAndExecute('a1', 'u-decider')).resolves.toEqual({
    ok: false,
    status: 'FAILED',
    error: ACTION_INTERNAL_ERROR,
  })
  expect(p.update.mock.calls[0][0].data.error).toBe(ACTION_INTERNAL_ERROR)
  expect(finishToolAudit).toHaveBeenCalledWith(
    'aud1',
    expect.objectContaining({ outcome: 'error', error: ACTION_INTERNAL_ERROR })
  )
  expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain('s3')
})

test('도메인·외부 API 오류 → 원문 유지하되 비밀은 가리고 1000자로 자른다', async () => {
  execute.mockRejectedValueOnce(
    new Error(`쿠팡 API 실패: https://api.x/y?access_token=abc123 ${'x'.repeat(2000)}`)
  )
  const out = await approveAndExecute('a1', 'u-decider')
  expect(out).toMatchObject({ status: 'FAILED' })
  const error = (out as { error: string }).error
  expect(error).toContain('쿠팡 API 실패')
  expect(error).toContain('access_token=[redacted]')
  expect(error).not.toContain('abc123')
  expect(error.length).toBe(1000)
  expect(p.update.mock.calls[0][0].data.error).toBe(error)
})

test('EXECUTED 기록 실패는 actionId를 로그에 남기고 다시 던진다', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  p.update.mockRejectedValue(new Error('db down'))
  await expect(approveAndExecute('a1', 'u-decider')).rejects.toThrow('db down')
  expect(log).toHaveBeenCalledWith(expect.stringContaining('EXECUTED 기록 실패'), 'a1')
})
