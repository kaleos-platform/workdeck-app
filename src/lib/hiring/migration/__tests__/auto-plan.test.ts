/** @jest-environment node */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_REVIEW_PASSES,
  computePlan,
  planNext,
  type PreparedLike,
  type QueueDeps,
  type QueueJob,
  type ReviewItemLike,
} from '../auto-plan'

const item = (id: string, text = '010-1234-5678로 연락'): ReviewItemLike => ({
  kind: 'posting',
  id,
  contentHash: `h${id}`,
  hits: { url: 0 },
  texts: [{ path: 'a', text, flagged: true }],
})
const prepared = (
  pending: ReviewItemLike[],
  extra: Partial<PreparedLike['summary']> = {}
): PreparedLike => ({
  summary: { review: { pendingItems: pending.length }, ...extra },
  review: { sourceSpaceId: '7', items: pending, images: [] },
  postings: [{ sourcePostingId: '1', posting: { title: '공고1' } }],
  templates: [],
})

describe('computePlan', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auto-plan-'))
    for (const sub of ['postings', 'templates', 'assets']) mkdirSync(join(dir, sub))
    writeFileSync(join(dir, 'postings/1.json'), JSON.stringify({ sourcePostingId: '1' }))
    writeFileSync(join(dir, 'org.json'), JSON.stringify({ stores: [], positions: [] }))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const input = (over = {}) => ({
    jobId: 'j',
    userId: 'u',
    targetSpaceId: 's',
    brandCount: 1,
    packetsDir: dir,
    today: '2026-11-18',
    ...over,
  })
  const deps = (prepare: jest.Mock, over = {}) => ({
    prepare,
    writePackets: jest.fn(),
    dryRun: jest.fn().mockResolvedValue({ conflicts: 0, refused: 0, summary: {} }),
    targetHasData: jest.fn().mockResolvedValue(false),
    ...over,
  })

  it('1단계에 안 잡힌 항목이 남으면 review 를 갱신해 반복하고, 조각은 누적 항목 기준', async () => {
    const prepare = jest
      .fn()
      .mockResolvedValueOnce(prepared([item('1')])) // ① review 없이
      .mockResolvedValueOnce(prepared([item('2', '문의 02-123-4567')])) // 내장 이미지 항목이 뒤늦게 대기
      .mockResolvedValueOnce(prepared([]))
    const result = await computePlan(deps(prepare), input())
    expect(prepare).toHaveBeenCalledTimes(3)
    expect(prepare.mock.calls[2][0].items.map((i: { id: string }) => i.id)).toEqual(['1', '2'])
    expect(result.blockReasons).toEqual([])
    expect(result.fragments.map((f) => f.id).sort()).toEqual(['1', '2'])
    expect(result.fragments.find((f) => f.id === '1')?.title).toBe('공고1')
  })

  it('최대 패스 후에도 대기 항목이 남으면 REVIEW_INCOMPLETE', async () => {
    const prepare = jest.fn().mockResolvedValue(prepared([item('1')]))
    const result = await computePlan(deps(prepare), input())
    expect(prepare).toHaveBeenCalledTimes(1 + MAX_REVIEW_PASSES)
    expect(result.blockReasons).toEqual(['REVIEW_INCOMPLETE'])
  })

  it('dry-run refused 는 IMPORT_REFUSED, 충돌은 LEDGER_CONFLICT, 기존 데이터는 TARGET_HAS_DATA', async () => {
    const prepare = jest.fn().mockResolvedValue(prepared([]))
    const result = await computePlan(
      deps(prepare, {
        dryRun: jest.fn().mockResolvedValue({ conflicts: 1, refused: 2, summary: {} }),
        targetHasData: jest.fn().mockResolvedValue(true),
      }),
      input()
    )
    expect(result.blockReasons).toEqual(['IMPORT_REFUSED', 'LEDGER_CONFLICT', 'TARGET_HAS_DATA'])
  })

  it('대상 Space 가 없으면 dry-run 없이 NO_TARGET_SPACE, 다중 브랜드는 MULTI_BRAND', async () => {
    const d = deps(jest.fn().mockResolvedValue(prepared([])))
    const result = await computePlan(d, input({ targetSpaceId: null, brandCount: 2 }))
    expect(d.dryRun).not.toHaveBeenCalled()
    expect(result.blockReasons).toEqual(['NO_TARGET_SPACE', 'MULTI_BRAND'])
  })

  it('소유권 불일치 사유는 OWNERSHIP_MISMATCH 로 막는다', async () => {
    const prepare = jest
      .fn()
      .mockResolvedValue(prepared([], { postings: { reasons: { ASSET_SCOPE_MISMATCH: 1 } } }))
    expect((await computePlan(deps(prepare), input())).blockReasons).toEqual(['OWNERSHIP_MISMATCH'])
  })
})

describe('planNext', () => {
  const job = (id: string, status: QueueJob['status']): QueueJob => ({
    id,
    userId: `u${id}`,
    openingBrandId: id,
    status,
  })
  const queue = (over: Partial<QueueDeps>): QueueDeps => ({
    nextMatched: async () => null,
    blockedRetries: async () => [],
    targetFor: async () => ({ spaceId: 's', multipleOwners: false }),
    touch: jest.fn(async () => {}),
    plan: jest.fn(async () => {}),
    fail: jest.fn(async () => {}),
    ...over,
  })

  it('NO_TARGET_SPACE 행이 많아도 새 MATCHED 가 먼저 처리된다(굶주림 없음)', async () => {
    const d = queue({
      nextMatched: async () => job('new', 'MATCHED'),
      blockedRetries: async () => Array.from({ length: 20 }, (_, i) => job(`b${i}`, 'BLOCKED')),
      targetFor: async (userId) => ({
        spaceId: userId === 'unew' ? 's' : null,
        multipleOwners: false,
      }),
    })
    expect(await planNext(d)).toEqual({ status: 'PLANNED', jobId: 'new' })
    expect(d.plan).toHaveBeenCalledWith(job('new', 'MATCHED'), {
      spaceId: 's',
      multipleOwners: false,
    })
    expect(d.touch).not.toHaveBeenCalled()
  })

  it('MATCHED 가 없으면 대상 Space 없는 BLOCKED 는 touch 로 순환시키고 대상이 생긴 행을 계획한다', async () => {
    const d = queue({
      blockedRetries: async () => [job('b1', 'BLOCKED'), job('b2', 'BLOCKED')],
      targetFor: async (userId) => ({
        spaceId: userId === 'ub2' ? 's2' : null,
        multipleOwners: false,
      }),
    })
    expect(await planNext(d)).toEqual({ status: 'PLANNED', jobId: 'b2' })
    expect(d.touch).toHaveBeenCalledWith('b1')
    expect(d.plan).toHaveBeenCalledWith(job('b2', 'BLOCKED'), {
      spaceId: 's2',
      multipleOwners: false,
    })
  })

  it('모두 대상 없음이면 PLAN_NONE', async () => {
    const d = queue({
      blockedRetries: async () => [job('b1', 'BLOCKED')],
      targetFor: async () => ({ spaceId: null, multipleOwners: false }),
    })
    expect(await planNext(d)).toEqual({ status: 'PLAN_NONE' })
  })

  it('다중 OWNER 행은 touch 로 순환시키지 않고 계획해 차단 사유를 갱신한다', async () => {
    const multi = { spaceId: null, multipleOwners: true }
    const d = queue({
      blockedRetries: async () => [job('b1', 'BLOCKED')],
      targetFor: async () => multi,
    })
    expect(await planNext(d)).toEqual({ status: 'PLANNED', jobId: 'b1' })
    expect(d.touch).not.toHaveBeenCalled()
    expect(d.plan).toHaveBeenCalledWith(job('b1', 'BLOCKED'), multi)
  })

  it('이미 MULTIPLE_OWNER_SPACES 로 기록된 행은 여전히 다중 OWNER 면 touch 만, 1개로 줄면 재계획', async () => {
    const stuck: QueueJob = { ...job('b1', 'BLOCKED'), blockReasons: ['MULTIPLE_OWNER_SPACES'] }
    const still = queue({
      blockedRetries: async () => [stuck],
      targetFor: async () => ({ spaceId: null, multipleOwners: true }),
    })
    expect(await planNext(still)).toEqual({ status: 'PLAN_NONE' })
    expect(still.touch).toHaveBeenCalledWith('b1')
    expect(still.plan).not.toHaveBeenCalled()
    const reduced = queue({ blockedRetries: async () => [stuck] })
    expect(await planNext(reduced)).toEqual({ status: 'PLANNED', jobId: 'b1' })
  })

  it('plan 실패는 고정 코드로 fail 처리한다', async () => {
    const d = queue({
      nextMatched: async () => job('m', 'MATCHED'),
      plan: jest.fn(async () => {
        throw new Error('secret detail 010-1234-5678')
      }),
    })
    expect(await planNext(d)).toEqual({ status: 'PLAN_FAILED', jobId: 'm' })
    expect(d.fail).toHaveBeenCalledWith(job('m', 'MATCHED'), 'OPENING_AUTO_MIGRATE_FAILED')
  })
})
