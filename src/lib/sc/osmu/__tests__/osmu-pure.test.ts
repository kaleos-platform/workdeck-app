import { blocksToText } from '../notion-blocks'
import { verifyEvidence } from '../evidence'
import { notionStatusFor, canCancel } from '../projection'
import { driveFolderIdFromUrl, readRequestSnapshot, NOTION_STATUS } from '../notion-schema'

const rt = (s: string) => ({ rich_text: [{ plain_text: s }] })

describe('blocksToText', () => {
  it('서식 없는 평문 + 블록 구간, 이미지 감지', () => {
    const r = blocksToText([
      { id: 'b1', type: 'heading_2', heading_2: rt('행사 개요') },
      { id: 'b2', type: 'bulleted_list_item', bulleted_list_item: rt('참가자 30명') },
      { id: 'b3', type: 'image', image: {} },
      { id: 'b4', type: 'paragraph', paragraph: rt('  ') },
      { id: 'b5', type: 'paragraph', paragraph: rt('아이들이 직접 만들었다') },
    ])
    expect(r.text).toBe('행사 개요\n- 참가자 30명\n아이들이 직접 만들었다')
    expect(r.hasImages).toBe(true)
    expect(r.segments.map((s) => s.blockId)).toEqual(['b1', 'b2', 'b5'])
    expect(r.text.slice(r.segments[1].start, r.segments[1].end)).toBe('참가자 30명')
  })
})

describe('verifyEvidence', () => {
  it('원문 부분 문자열이 아닌 근거는 버리고 블록 id 를 붙인다', () => {
    const { text, segments } = blocksToText([
      { id: 'b1', type: 'paragraph', paragraph: rt('참가자 30명이 키트를 만들었다') },
      { id: 'b2', type: 'quote', quote: rt('정말 재밌었어요') },
    ])
    const { data, dropped } = verifyEvidence(
      {
        fields: { org: '미닝랩' },
        facts: [
          { text: '30명 참가', evidence: '참가자 30명' },
          { text: '100명 참가', evidence: '참가자 100명' },
        ],
        quotes: [
          { speaker: '학생', text: '재밌었다', evidence: '정말 재밌었어요' },
          { text: 'x', evidence: '' },
        ],
      },
      text,
      segments
    )
    expect(dropped).toBe(2)
    expect(data.facts).toEqual([
      { text: '30명 참가', evidence: { text: '참가자 30명', offset: 0, blockId: 'b1' } },
    ])
    expect(data.quotes[0].evidence.blockId).toBe('b2')
  })
})

describe('notionStatusFor', () => {
  it('요청·배포 상태를 노션 라벨로', () => {
    expect(notionStatusFor({ state: 'READY' })).toBe(NOTION_STATUS.WRITING)
    expect(notionStatusFor({ state: 'PROPOSED' })).toBe(NOTION_STATUS.AWAITING_APPROVAL)
    expect(notionStatusFor({ state: 'NEEDS_INPUT' })).toBe(NOTION_STATUS.NEEDS_REVIEW)
    expect(notionStatusFor({ state: 'APPROVED', deployment: null })).toBe(
      NOTION_STATUS.NEEDS_REVIEW
    )
    const dep = (
      status: 'AWAITING_ASSETS' | 'AWAITING_MANUAL' | 'PUBLISHED',
      platformUrl: string | null = null
    ) => ({
      state: 'APPROVED' as const,
      deployment: { status, platformUrl },
    })
    expect(notionStatusFor(dep('AWAITING_ASSETS'))).toBe(NOTION_STATUS.AWAITING_PHOTOS)
    expect(notionStatusFor(dep('AWAITING_MANUAL'))).toBe(NOTION_STATUS.DRAFT_CHECK)
    expect(notionStatusFor(dep('PUBLISHED'))).toBe(NOTION_STATUS.NEEDS_REVIEW)
    expect(notionStatusFor(dep('PUBLISHED', 'https://blog.naver.com/x/1'))).toBe(
      NOTION_STATUS.PUBLISHED
    )
    expect(canCancel('PROPOSED')).toBe(true)
    expect(canCancel('APPROVED')).toBe(false)
  })
})

describe('notion-schema', () => {
  it('요청 snapshot·드라이브 폴더 id', () => {
    const s = readRequestSnapshot({
      id: 'p1',
      last_edited_time: '2026-11-08T00:00:00.000Z',
      properties: {
        제목: { type: 'title', title: [{ plain_text: '환경교육 후기' }] },
        유형: { type: 'select', select: { name: '블로그' } },
        소재: { type: 'relation', relation: [{ id: 's1' }] },
        '희망 발행일': { type: 'date', date: null },
      },
    })
    expect(s).toEqual({
      title: '환경교육 후기',
      kind: '블로그',
      brief: '',
      desiredDate: null,
      sourcePageIds: ['s1'],
      basedOnPageIds: [],
    })
    expect(
      driveFolderIdFromUrl('https://drive.google.com/drive/folders/1AbCdEfGhIjK_lm?usp=sharing')
    ).toBe('1AbCdEfGhIjK_lm')
    expect(driveFolderIdFromUrl('https://example.com')).toBeNull()
  })
})
