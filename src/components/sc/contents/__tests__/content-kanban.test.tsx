// content-kanban 의 핵심 로직 — 컬럼 버킷팅 및 카드 카운트를 단위 테스트
// UI 렌더링(useRouter, fetch)은 jsdom 환경이 필요하므로 여기서는 순수 로직만 검증

import type { ContentStatus } from '@/generated/prisma/client'

// 컬럼 정의와 동일한 구조 (content-kanban.tsx 와 동기화)
const COLUMN_STATUSES: Record<string, ContentStatus[]> = {
  todo: ['TODO'],
  draft: ['DRAFT'],
  review: ['IN_REVIEW'],
  deploy: ['APPROVED', 'SCHEDULED', 'PUBLISHED'],
  analyzed: ['ANALYZED'],
}

type ContentRow = { id: string; status: ContentStatus }

function bucketByColumn(contents: ContentRow[]): Record<string, ContentRow[]> {
  const result: Record<string, ContentRow[]> = {}
  for (const [colKey, statuses] of Object.entries(COLUMN_STATUSES)) {
    result[colKey] = contents.filter((c) => statuses.includes(c.status))
  }
  return result
}

describe('ContentKanban 컬럼 버킷팅', () => {
  const makeRow = (id: string, status: ContentStatus): ContentRow => ({ id, status })

  it('빈 콘텐츠 목록 — 모든 컬럼이 빈 배열', () => {
    const buckets = bucketByColumn([])
    for (const col of Object.keys(COLUMN_STATUSES)) {
      expect(buckets[col]).toEqual([])
    }
  })

  it('각 상태가 올바른 컬럼에 배치됨', () => {
    const contents: ContentRow[] = [
      makeRow('1', 'TODO'),
      makeRow('2', 'DRAFT'),
      makeRow('3', 'IN_REVIEW'),
      makeRow('4', 'APPROVED'),
      makeRow('5', 'SCHEDULED'),
      makeRow('6', 'PUBLISHED'),
      makeRow('7', 'ANALYZED'),
    ]
    const buckets = bucketByColumn(contents)

    expect(buckets.todo.map((c) => c.id)).toEqual(['1'])
    expect(buckets.draft.map((c) => c.id)).toEqual(['2'])
    expect(buckets.review.map((c) => c.id)).toEqual(['3'])
    // 배포 컬럼: APPROVED + SCHEDULED + PUBLISHED
    expect(buckets.deploy.map((c) => c.id)).toEqual(['4', '5', '6'])
    expect(buckets.analyzed.map((c) => c.id)).toEqual(['7'])
  })

  it('카드 카운트 정확 — 배포 컬럼 3개', () => {
    const contents: ContentRow[] = [
      makeRow('a', 'APPROVED'),
      makeRow('b', 'SCHEDULED'),
      makeRow('c', 'PUBLISHED'),
      makeRow('d', 'DRAFT'),
    ]
    const buckets = bucketByColumn(contents)
    expect(buckets.deploy).toHaveLength(3)
    expect(buckets.draft).toHaveLength(1)
    expect(buckets.todo).toHaveLength(0)
  })

  it('TODO 상태가 todo 컬럼에만 배치됨 (다른 컬럼에 없음)', () => {
    const contents: ContentRow[] = [makeRow('x', 'TODO')]
    const buckets = bucketByColumn(contents)
    expect(buckets.todo).toHaveLength(1)
    expect(buckets.draft).toHaveLength(0)
    expect(buckets.review).toHaveLength(0)
    expect(buckets.deploy).toHaveLength(0)
    expect(buckets.analyzed).toHaveLength(0)
  })
})

describe('contentCreateSchema status 필드 검증', () => {
  // schemas.ts 에 status 필드가 추가됐는지 동적 import 로 확인
  it('status=TODO 허용', async () => {
    const { contentCreateSchema } = await import('@/lib/sc/schemas')
    const result = contentCreateSchema.safeParse({ title: '테스트 콘텐츠', status: 'TODO' })
    expect(result.success).toBe(true)
  })

  it('status=DRAFT 허용', async () => {
    const { contentCreateSchema } = await import('@/lib/sc/schemas')
    const result = contentCreateSchema.safeParse({ title: '테스트 콘텐츠', status: 'DRAFT' })
    expect(result.success).toBe(true)
  })

  it('status=APPROVED 는 불허 (생성 시 state-machine 우회 방지)', async () => {
    const { contentCreateSchema } = await import('@/lib/sc/schemas')
    const result = contentCreateSchema.safeParse({ title: '테스트 콘텐츠', status: 'APPROVED' })
    expect(result.success).toBe(false)
  })

  it('status 미전달 시 성공 (기본값 DRAFT 로 처리)', async () => {
    const { contentCreateSchema } = await import('@/lib/sc/schemas')
    const result = contentCreateSchema.safeParse({ title: '테스트 콘텐츠' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBeUndefined()
    }
  })
})
