/**
 * sc_request_post 경로 e2e — 실 dev DB, 노션·수신 처리는 가짜.
 * 소재 찾기 → 발행 행 생성/재사용 → 바로 수신 처리 → 요청 상태 반환.
 */
import { prisma } from '@/lib/prisma'
import { saveSpaceCredential } from '@/lib/agent/integrations/space-credential'
import { requestPost } from '../request-create'
import * as notion from '../notion'
import * as intake from '../intake'

jest.mock('../notion', () => ({
  queryDataSource: jest.fn(),
  createPage: jest.fn(),
  updatePageProperties: jest.fn().mockResolvedValue({}),
}))
jest.mock('../intake', () => ({ runIntakeForSpace: jest.fn() }))

process.env.ENCRYPTION_KEY_V1 ??= 'a'.repeat(64)
const d = process.env.DATABASE_URL ? describe : describe.skip
const SPACE_ID = 'e2e00000-0000-4000-8000-0000000005c1'
const n = notion as jest.Mocked<typeof notion>
const runIntake = intake.runIntakeForSpace as jest.Mock

const title = (s: string) => ({ type: 'title', title: [{ plain_text: s }] })
const sel = (s: string | null) => ({ type: 'select', select: s ? { name: s } : null })
const sourcePage = (id: string, t: string) => ({
  id,
  last_edited_time: 'x',
  properties: { 제목: title(t) },
})
const reqPage = (id: string, status: string | null) => ({
  id,
  last_edited_time: 'x',
  properties: { 제목: title('r'), 상태: sel(status), 유형: sel('블로그') },
})

/** 수신 처리 가짜: 그 노션 행으로 요청을 READY 로 만든다. */
function intakeMakes(pageId: string, state: 'READY' | 'NEEDS_INPUT' = 'READY') {
  runIntake.mockImplementationOnce(async () => {
    await prisma.scPublishRequest.upsert({
      where: { spaceId_notionPageId: { spaceId: SPACE_ID, notionPageId: pageId } },
      create: { spaceId: SPACE_ID, notionPageId: pageId, snapshot: {}, revision: 'x', state },
      update: { state },
    })
    return { received: 1, canceled: 0, processed: 1, projected: 1, described: 0, errors: [] }
  })
}

d('sc_request_post', () => {
  beforeAll(async () => {
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E OSMU Request', type: 'PERSONAL' },
    })
    await prisma.scNotionConnection.create({
      data: { spaceId: SPACE_ID, sourceDataSourceId: 'ds-src', requestDataSourceId: 'ds-req' },
    })
    await saveSpaceCredential(SPACE_ID, 'notion', { token: 'secret_test' }, {})
  })
  beforeEach(() => jest.clearAllMocks())
  afterAll(async () => {
    await prisma.scPublishRequest.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: SPACE_ID } })
    await prisma.$disconnect()
  })

  test('소재를 못 찾으면 소재 제목 목록을 알려준다', async () => {
    n.queryDataSource
      .mockResolvedValueOnce([]) // 제목 검색
      .mockResolvedValueOnce([
        sourcePage('s1', '조민주 선생님 협업 1'),
        sourcePage('s2', '조민주 선생님 협업 2'),
      ] as never)
    await expect(
      requestPost(SPACE_ID, { source: '없는 행사', kind: '블로그' }, Date.now() + 10_000)
    ).rejects.toThrow(
      '소재를 찾지 못했습니다. 소재 제목: 조민주 선생님 협업 1 / 조민주 선생님 협업 2'
    )
    expect(runIntake).not.toHaveBeenCalled()
  })

  test('진행 중 행이 없으면 「작성 요청」 행을 만들고 바로 처리한다', async () => {
    n.queryDataSource
      .mockResolvedValueOnce([sourcePage('s1', '조민주 선생님 협업 1')] as never)
      .mockResolvedValueOnce([reqPage('old', '게시 완료')] as never) // 끝난 행은 재사용 안 함
    n.createPage.mockResolvedValueOnce({
      id: 'new-page',
      url: 'u',
      last_edited_time: 'x',
      properties: {},
    })
    intakeMakes('new-page')
    const out = await requestPost(
      SPACE_ID,
      { source: '협업 1', kind: '블로그', brief: '초3 수업 후기 중심' },
      Date.now() + 10_000
    )
    const props = n.createPage.mock.calls[0][2]
    expect(props['상태']).toEqual({ select: { name: '작성 요청' } })
    expect(props['소재']).toEqual({ relation: [{ id: 's1' }] })
    expect(props['관점·요청 사항']).toEqual({
      rich_text: [{ type: 'text', text: { content: '초3 수업 후기 중심' } }],
    })
    expect(out).toMatchObject({
      state: 'READY',
      source: '조민주 선생님 협업 1',
      reusedExistingRow: false,
    })
    expect(out.requestId).toBeTruthy()
  })

  test('빈 상태·확인 필요 행은 재사용해 다시 요청하고, 진행 중 행은 건드리지 않는다', async () => {
    n.queryDataSource
      .mockResolvedValueOnce([sourcePage('s1', '조민주 선생님 협업 1')] as never)
      .mockResolvedValueOnce([reqPage('blocked', '확인 필요')] as never)
    intakeMakes('blocked')
    const a = await requestPost(SPACE_ID, { source: '협업 1', kind: '블로그' }, Date.now() + 10_000)
    expect(a.reusedExistingRow).toBe(true)
    expect(n.updatePageProperties).toHaveBeenCalledWith('secret_test', 'blocked', {
      상태: { select: { name: '작성 요청' } },
    })
    expect(n.createPage).not.toHaveBeenCalled()

    jest.clearAllMocks()
    n.queryDataSource
      .mockResolvedValueOnce([sourcePage('s1', '조민주 선생님 협업 1')] as never)
      .mockResolvedValueOnce([reqPage('busy', '승인 대기')] as never)
    intakeMakes('busy')
    const b = await requestPost(SPACE_ID, { source: '협업 1', kind: '블로그' }, Date.now() + 10_000)
    expect(b.reusedExistingRow).toBe(true)
    expect(n.updatePageProperties).not.toHaveBeenCalled()
  })
})
