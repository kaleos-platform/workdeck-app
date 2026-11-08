/**
 * OSMU 수신 cron e2e — 실 dev DB, 노션·AI·드라이브는 가짜.
 * 수신 → 소재 정규화(근거 검증) → READY/NEEDS_INPUT → 노션 상태 되쓰기(멱등) → 취소 반영.
 */
import { prisma } from '@/lib/prisma'
import { saveSpaceCredential } from '@/lib/agent/integrations/space-credential'
import { runIntakeForSpace } from '../intake'
import * as notion from '../notion'

jest.mock('../notion', () => ({
  queryDataSource: jest.fn(),
  getPage: jest.fn(),
  listPageBlocks: jest.fn(),
  updatePageProperties: jest.fn().mockResolvedValue({}),
}))
jest.mock('../media-sync', () => ({
  syncSourceMedia: jest.fn().mockResolvedValue(3),
  describePendingMedia: jest.fn().mockResolvedValue(0),
}))
jest.mock('@/lib/ai/resolve', () => ({
  generateTextForSpace: jest.fn().mockResolvedValue({
    result: {
      content: JSON.stringify({
        facts: [
          { text: '30명 참가', evidence: '참가자 30명' },
          { text: '지어낸 사실', evidence: '원문에 없는 문장' },
        ],
        quotes: [],
      }),
    },
  }),
}))

// 로컬 .env.local 엔 v1 키가 없다 — 이 테스트 Space 전용 암·복호화용 임시 키.
process.env.ENCRYPTION_KEY_V1 ??= 'a'.repeat(64)

const d = process.env.DATABASE_URL ? describe : describe.skip
const SPACE_ID = 'e2e00000-0000-4000-8000-0000000005b1'
const n = notion as jest.Mocked<typeof notion>

const title = (s: string) => ({ type: 'title', title: [{ plain_text: s }] })
const select = (s: string) => ({ type: 'select', select: { name: s } })
const relation = (ids: string[]) => ({ type: 'relation', relation: ids.map((id) => ({ id })) })
const reqPage = (id: string, kind: string) => ({
  id,
  last_edited_time: '2026-11-08T00:00:00.000Z',
  properties: { 제목: title(`${kind} 요청`), 유형: select(kind), 소재: relation(['src-1']) },
})

d('OSMU 수신', () => {
  beforeAll(async () => {
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E OSMU Intake', type: 'PERSONAL' },
    })
    await prisma.scNotionConnection.create({
      data: { spaceId: SPACE_ID, sourceDataSourceId: 'ds-src', requestDataSourceId: 'ds-req' },
    })
    await prisma.scDriveConnection.create({
      data: {
        spaceId: SPACE_ID,
        serviceAccountEmail: 'wd-d-e2e-intake@test.iam',
        rootId: 'drive-root',
      },
    })
    await saveSpaceCredential(SPACE_ID, 'notion', { token: 'secret_test' }, {})
    n.getPage.mockResolvedValue({
      id: 'src-1',
      last_edited_time: '2026-11-08T00:00:00.000Z',
      properties: {
        제목: title('환경교육'),
        기관: { type: 'rich_text', rich_text: [{ plain_text: '미닝랩' }] },
        '미디어 폴더': {
          type: 'url',
          url: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlm',
        },
      },
    } as never)
    n.listPageBlocks.mockResolvedValue([
      {
        id: 'b1',
        type: 'paragraph',
        paragraph: { rich_text: [{ plain_text: '참가자 30명이 키트를 만들었다' }] },
      },
    ])
  })

  afterAll(async () => {
    await prisma.scPublishRequest.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.scSource.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: SPACE_ID } })
    await prisma.$disconnect()
  })

  test('수신·정규화·projection·취소', async () => {
    n.queryDataSource.mockImplementation(async (_t, _ds, filter) =>
      (filter as { select: { equals: string } }).select.equals === '작성 요청'
        ? ([reqPage('p-blog', '블로그'), reqPage('p-press', '보도자료')] as never)
        : []
    )
    const r1 = await runIntakeForSpace(SPACE_ID, Date.now() + 60_000)
    expect(r1.errors).toEqual([])
    expect(r1.received).toBe(2)
    expect(r1.processed).toBe(2)

    const blog = await prisma.scPublishRequest.findUniqueOrThrow({
      where: { spaceId_notionPageId: { spaceId: SPACE_ID, notionPageId: 'p-blog' } },
      include: { sourceVersion: true, source: true },
    })
    expect(blog.state).toBe('READY')
    expect(blog.source!.driveFolderId).toBe('1AbCdEfGhIjKlm')
    const data = blog.sourceVersion!.data as {
      facts: { text: string; evidence: { blockId: string } }[]
    }
    expect(data.facts).toHaveLength(1) // 지어낸 사실은 근거 검증에서 버려짐
    expect(data.facts[0].evidence.blockId).toBe('b1')

    const press = await prisma.scPublishRequest.findUniqueOrThrow({
      where: { spaceId_notionPageId: { spaceId: SPACE_ID, notionPageId: 'p-press' } },
    })
    expect(press.state).toBe('NEEDS_INPUT')

    const labels = Object.fromEntries(
      n.updatePageProperties.mock.calls.map(([, id, props]) => [
        id,
        (props['상태'] as { select: { name: string } }).select.name,
      ])
    )
    expect(labels).toEqual({ 'p-blog': '작성 중', 'p-press': '확인 필요' })

    // 다시 돌면: 신규 수신 0, 같은 내용은 버전 재사용, 노션 쓰기 없음(멱등)
    n.updatePageProperties.mockClear()
    // 노션은 이제 되쓰기된 상태(작성 중·확인 필요)라 「작성 요청」 조회는 비어 있다.
    n.queryDataSource.mockResolvedValue([])
    const r2 = await runIntakeForSpace(SPACE_ID, Date.now() + 60_000)
    expect(r2.received).toBe(0)
    expect(n.updatePageProperties).not.toHaveBeenCalled()

    // 확인 필요였던 요청을 사람이 고쳐(유형 블로그) 다시 「작성 요청」 → 새 snapshot 으로 재시작해 READY
    n.queryDataSource.mockImplementation(async (_t, _ds, filter) =>
      (filter as { select: { equals: string } }).select.equals === '작성 요청'
        ? ([reqPage('p-press', '블로그')] as never)
        : []
    )
    const rRetry = await runIntakeForSpace(SPACE_ID, Date.now() + 60_000)
    expect(rRetry.received).toBe(1)
    const retried = await prisma.scPublishRequest.findUniqueOrThrow({
      where: { spaceId_notionPageId: { spaceId: SPACE_ID, notionPageId: 'p-press' } },
    })
    expect(retried.state).toBe('READY')
    expect((retried.snapshot as { kind: string }).kind).toBe('블로그')

    // 승인 이후 「취소」는 반영하지 않고 실제 상태로 되돌려 쓴다
    await prisma.scPublishRequest.update({ where: { id: retried.id }, data: { state: 'APPROVED' } })
    n.updatePageProperties.mockClear()
    n.queryDataSource.mockImplementation(async (_t, _ds, filter) =>
      (filter as { select: { equals: string } }).select.equals === '취소'
        ? ([reqPage('p-press', '블로그')] as never)
        : []
    )
    const rLate = await runIntakeForSpace(SPACE_ID, Date.now() + 60_000)
    expect(rLate.canceled).toBe(0)
    expect(n.updatePageProperties).toHaveBeenCalledWith('secret_test', 'p-press', {
      상태: { select: { name: '확인 필요' } },
    })
    n.updatePageProperties.mockClear()

    // 사람이 「취소」로 바꾸면 승인 전 요청은 취소
    n.queryDataSource.mockImplementation(async (_t, _ds, filter) =>
      (filter as { select: { equals: string } }).select.equals === '취소'
        ? ([reqPage('p-blog', '블로그')] as never)
        : []
    )
    const r3 = await runIntakeForSpace(SPACE_ID, Date.now() + 60_000)
    expect(r3.canceled).toBe(1)
    expect(n.updatePageProperties).toHaveBeenCalledWith('secret_test', 'p-blog', {
      상태: { select: { name: '취소' } },
    })
  })
})
