/** @jest-environment node */
import { createHmac } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  JOB_STATUSES,
  buildAutoReview,
  buildSnapshot,
  canTransition,
  classifyPlan,
  emailHashVariants,
  extractContactFragments,
  pickTargetSpace,
  planMatches,
  assertBackfillMatches,
  type JobStatus,
} from '../auto-job'

describe('canTransition', () => {
  const allowed: [JobStatus, JobStatus][] = [
    ['MATCHED', 'PLANNED'],
    ['MATCHED', 'BLOCKED'],
    ['BLOCKED', 'PLANNED'],
    ['BLOCKED', 'FAILED'], // 재계획 재시도 상한(PLAN_RETRY_EXHAUSTED)
    ['PLANNED', 'APPROVED'],
    ['PLANNED', 'HELD'],
    ['FAILED', 'HELD'],
    ['APPROVED', 'APPLYING'],
    ['APPLYING', 'APPLIED'],
    ['APPLIED', 'GRANTED'],
    ['GRANTED', 'DONE'],
  ]
  it.each(allowed)('%s → %s 허용', (from, to) => expect(canTransition(from, to)).toBe(true))

  const denied: [JobStatus, JobStatus][] = [
    ['MATCHED', 'APPROVED'],
    ['BLOCKED', 'APPROVED'],
    ['PLANNED', 'APPLYING'],
    ['DONE', 'HELD'],
    ['HELD', 'PLANNED'],
    ['APPLIED', 'DONE'],
  ]
  it.each(denied)('%s → %s 거부', (from, to) => expect(canTransition(from, to)).toBe(false))

  it('모든 상태가 전이 표에 있다', () => {
    for (const status of JOB_STATUSES) expect(() => canTransition(status, 'HELD')).not.toThrow()
  })
})

describe('emailHashVariants', () => {
  const hmac = (value: string) => createHmac('sha256', 'k').update(value).digest('hex')
  it('원문·trim·lower·trim+lower 의 HMAC 을 중복 없이 만든다', () => {
    const variants = emailHashVariants('  Ab@Example.com ', 'k')
    expect(new Set(variants)).toEqual(
      new Set([
        hmac('  Ab@Example.com '),
        hmac('Ab@Example.com'),
        hmac('  ab@example.com '),
        hmac('ab@example.com'),
      ])
    )
    expect(emailHashVariants('a@b.co', 'k')).toEqual([hmac('a@b.co')])
  })
})

describe('pickTargetSpace', () => {
  const at = (day: number) => new Date(`2026-01-0${day}T00:00:00Z`)
  it('없으면 null', () => expect(pickTargetSpace([])).toBeNull())
  it('OWNER 가 아니거나 모집 관리가 꺼진 Space 는 제외한다', () => {
    expect(
      pickTargetSpace([
        { id: 'a', role: 'MEMBER', memberSince: at(1), recruitingActive: true },
        { id: 'b', role: 'OWNER', memberSince: at(2), recruitingActive: false },
      ])
    ).toBeNull()
  })
  it('여러 개면 가장 오래된 1곳', () => {
    expect(
      pickTargetSpace([
        { id: 'new', role: 'OWNER', memberSince: at(3), recruitingActive: true },
        { id: 'old', role: 'OWNER', memberSince: at(1), recruitingActive: true },
        { id: 'mid', role: 'OWNER', memberSince: at(2), recruitingActive: true },
      ])
    ).toBe('old')
  })
})

describe('classifyPlan', () => {
  const base = {
    targetSpaceId: 's',
    brandCount: 1,
    summary: {},
    conflicts: 0,
    targetHasData: false,
  }
  it('깨끗하면 차단 없음', () => expect(classifyPlan(base).blockReasons).toEqual([]))
  it('차단 사유를 모두 분류한다', () => {
    const result = classifyPlan({
      targetSpaceId: null,
      brandCount: 2,
      summary: {
        postings: { reasons: { ASSET_SCOPE_MISMATCH: 1, RESOURCE_SCOPE_MISMATCH: 1 } },
        siblingOwned: { files: 1, contents: 0 },
      },
      conflicts: 1,
      targetHasData: true,
    })
    expect(result.blockReasons).toEqual([
      'NO_TARGET_SPACE',
      'MULTI_BRAND',
      'OWNERSHIP_MISMATCH',
      'SIBLING_ASSET',
      'LEDGER_CONFLICT',
      'TARGET_HAS_DATA',
    ])
  })
  it('제외·보류 사유는 경고로만 남기고 차단하지 않는다', () => {
    const result = classifyPlan({
      ...base,
      summary: {
        postings: { reasons: { OUT_OF_WINDOW: 3, ASSET_TOO_LARGE: 1 } },
        templates: { reasons: { ASSET_TOO_LARGE: 2 } },
      },
    })
    expect(result.blockReasons).toEqual([])
    expect(result.warnings).toEqual({ OUT_OF_WINDOW: 3, ASSET_TOO_LARGE: 3 })
  })
})

describe('buildAutoReview', () => {
  const candidates = {
    sourceSpaceId: '7',
    items: [
      { kind: 'posting' as const, id: '1', contentHash: 'h1', hits: { url: 0 } },
      { kind: 'template' as const, id: '2', contentHash: 'h2', hits: { url: 0 } },
      { kind: 'posting' as const, id: '3', contentHash: 'h3', hits: { url: 1 } },
    ],
    images: [
      { sha256: 'aa', owners: ['posting:1'] },
      { sha256: 'bb', owners: ['template:2'] },
      { sha256: 'cc', owners: ['posting:1', 'template:2'] },
    ],
  }
  it('연락처 항목 전부 + 이미지 전부, assetScopes 비움, reviewer auto:<jobId>', () => {
    const review = buildAutoReview(candidates, 'job1', '2026-11-18')
    expect(review.reviewer).toBe('auto:job1')
    expect(review.assetScopes).toEqual([])
    expect(review.items.map((item) => item.id)).toEqual(['1', '2'])
    expect(review.images).toEqual(['aa', 'bb', 'cc'])
  })
  it('민감 URL 적중 항목은 넣지 않는다', () => {
    const review = buildAutoReview(candidates, 'job1', '2026-11-18')
    expect(review.items.map((item) => item.id)).not.toContain('3')
  })
})

describe('extractContactFragments', () => {
  it('항목 제목과 감지 문구 앞뒤 20자 조각만 남긴다', () => {
    const long = `${'가'.repeat(50)} 010-1234-5678 ${'나'.repeat(50)}`
    const [result] = extractContactFragments([
      {
        kind: 'posting',
        id: '1',
        title: '공고',
        texts: [
          { path: 'a', text: long, flagged: true },
          { path: 'b', text: '평범한 문장', flagged: false },
        ],
      },
    ])
    expect(result.title).toBe('공고')
    expect(result.fragments).toHaveLength(1)
    expect(result.fragments[0]).toContain('010-1234-5678')
    expect(result.fragments[0].length).toBeLessThanOrEqual(13 + 40)
    expect(result.fragments[0]).not.toContain('가'.repeat(21))
  })
  it('지원서 폼 문항명의 연락처 키워드는 무시한다', () => {
    const [result] = extractContactFragments([
      {
        kind: 'posting',
        id: '1',
        texts: [{ path: 'posting.applicationEntries.label', text: '연락처', flagged: true }],
      },
    ])
    expect(result.fragments).toEqual([])
  })
})

describe('buildSnapshot', () => {
  let dir: string
  const write = (path: string, value: unknown) =>
    writeFileSync(join(dir, path), JSON.stringify(value))
  const setup = (opts: { snapshotAt: string; title: string }) => {
    for (const sub of ['postings', 'templates', 'assets'])
      mkdirSync(join(dir, sub), { recursive: true })
    write('postings/1.json', {
      sourcePostingId: '1',
      sourceSnapshotAt: opts.snapshotAt,
      posting: { title: opts.title },
    })
    write('templates/2.json', {
      sourceTemplateId: '2',
      sourceSnapshotAt: opts.snapshotAt,
      name: 't',
    })
    write('org.json', {
      sourceSnapshotAt: opts.snapshotAt,
      stores: [{ sourceId: '5', name: 's' }],
      positions: [{ sourceId: '6', name: 'p' }],
    })
    writeFileSync(join(dir, 'assets', 'a'.repeat(64)), 'x')
  }
  const meta = { userId: 'u', targetSpaceId: 's', adminMatched: true }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auto-job-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('실행 메타(스냅샷 시각)가 달라도 같고, 내용이 바뀌면 달라진다', () => {
    setup({ snapshotAt: '2026-11-18T00:00:00Z', title: 'A' })
    const first = buildSnapshot(dir, meta)
    expect(first.items.map((item) => `${item.kind}:${item.sourceId}`)).toEqual([
      'position:6',
      'posting:1',
      'store:5',
      'template:2',
    ])
    expect(first.images).toEqual(['a'.repeat(64)])

    setup({ snapshotAt: '2026-11-19T09:00:00Z', title: 'A' })
    expect(buildSnapshot(dir, meta)).toEqual(first)

    setup({ snapshotAt: '2026-11-19T09:00:00Z', title: 'B' })
    expect(buildSnapshot(dir, meta)).not.toEqual(first)
  })
})

describe('classifyPlan 추가 차단', () => {
  const base = {
    targetSpaceId: 's',
    brandCount: 1,
    summary: {},
    conflicts: 0,
    targetHasData: false,
  }
  it('dry-run refused 가 있으면 IMPORT_REFUSED, 검토 미완료면 REVIEW_INCOMPLETE', () => {
    expect(classifyPlan({ ...base, refused: 1 }).blockReasons).toEqual(['IMPORT_REFUSED'])
    expect(classifyPlan({ ...base, reviewIncomplete: true }).blockReasons).toEqual([
      'REVIEW_INCOMPLETE',
    ])
    expect(classifyPlan({ ...base, refused: 0 }).blockReasons).toEqual([])
  })
})

describe('planMatches', () => {
  const users = [{ id: 'u1' }, { id: 'u2' }]
  it('단일 브랜드는 MATCHED, 일치 없는 사용자도 확인 처리', () => {
    const plan = planMatches(users, new Map([['u1', ['10']]]), [])
    expect(plan.creates).toEqual([
      { openingBrandId: '10', userId: 'u1', status: 'MATCHED', blockReasons: [] },
    ])
    expect(plan.checkedUserIds).toEqual(['u1', 'u2'])
  })
  it('사용자가 브랜드 2개면 모두 MULTI_BRAND 로 BLOCKED', () => {
    const plan = planMatches([users[0]], new Map([['u1', ['10', '11']]]), [])
    expect(plan.creates.map((c) => [c.openingBrandId, c.status, c.blockReasons])).toEqual([
      ['10', 'BLOCKED', ['MULTI_BRAND']],
      ['11', 'BLOCKED', ['MULTI_BRAND']],
    ])
  })
  it('한 브랜드에 사용자 2명이면 job 1건에 MULTI_USER', () => {
    const plan = planMatches(
      users,
      new Map([
        ['u1', ['10']],
        ['u2', ['10']],
      ]),
      []
    )
    expect(plan.creates).toEqual([
      { openingBrandId: '10', userId: 'u1', status: 'BLOCKED', blockReasons: ['MULTI_USER'] },
    ])
  })
  it('이미 다른 사용자 job 이 있으면 기존 job 차단 대상, backfill(userId null)은 건드리지 않는다', () => {
    const plan = planMatches([users[1]], new Map([['u2', ['10', '20']]]), [
      { openingBrandId: '10', userId: 'u1' },
      { openingBrandId: '20', userId: null },
    ])
    expect(plan.creates).toEqual([])
    expect(plan.blockExisting).toEqual(['10'])
  })
})

describe('assertBackfillMatches', () => {
  it('DONE 은 원장 Space 집합이 정확히 {space}', () => {
    expect(() => assertBackfillMatches('DONE', 's', ['s', 's'])).not.toThrow()
    expect(() => assertBackfillMatches('DONE', 's', [])).toThrow('BACKFILL_LEDGER_MISMATCH')
    expect(() => assertBackfillMatches('DONE', 's', ['s', 'x'])).toThrow('BACKFILL_LEDGER_MISMATCH')
    expect(() => assertBackfillMatches('DONE', 's', ['x'])).toThrow('BACKFILL_LEDGER_MISMATCH')
  })
  it('HELD/none 은 원장 행 0건이어야 한다', () => {
    expect(() => assertBackfillMatches('HELD', 'none', [])).not.toThrow()
    expect(() => assertBackfillMatches('HELD', 'none', ['s'])).toThrow('BACKFILL_LEDGER_MISMATCH')
  })
})
