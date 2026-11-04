import { applyAssetPlan, buildPublishSnapshot, photoSlots, readAsideConfig } from '../aside-publish'
import { textToDoc } from '../text-to-doc'

const body = [
  '# 소제목',
  '첫 문단',
  '[사진: 키트 구성]',
  '둘째 문단 [문의 링크]',
  '[사진: 완성품]',
  '끝',
].join('\n')

function snap() {
  return buildPublishSnapshot({
    title: '제목',
    doc: textToDoc(body),
    deploymentUrl: 'https://app.test/c/abc',
    tags: ['환경교육'],
    autoPublish: false,
  })
}

describe('buildPublishSnapshot', () => {
  it('사진 자리에서 본문을 나누고 문의 링크를 추적 링크로 바꾼다', () => {
    const s = snap()
    expect(s.blocks.map((b) => b.kind)).toEqual(['html', 'photo', 'html', 'photo', 'html'])
    expect(photoSlots(s)).toEqual([
      { index: 0, label: '키트 구성' },
      { index: 1, label: '완성품' },
    ])
    const html = s.blocks.flatMap((b) => (b.kind === 'html' ? [b.html] : [])).join('')
    expect(html).toContain('https://app.test/c/abc')
    expect(html).not.toContain('[사진:')
    expect(html).not.toContain('[문의 링크]')
  })
})

describe('applyAssetPlan', () => {
  const allowed = new Set(['a1'])

  it('사진을 넣고 뺀 자리는 지운다', () => {
    const r = applyAssetPlan(snap(), { slots: [{ index: 0, assetId: 'a1' }, { index: 1, skip: true }] }, allowed)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.blocks.map((b) => b.kind)).toEqual(['html', 'photo', 'html', 'html'])
    expect(r.snapshot.blocks[1]).toMatchObject({ kind: 'photo', assetId: 'a1' })
  })

  it('빈 자리나 다른 콘텐츠 사진은 거부한다', () => {
    expect(applyAssetPlan(snap(), { slots: [{ index: 0, assetId: 'a1' }] }, allowed).ok).toBe(false)
    expect(
      applyAssetPlan(snap(), { slots: [{ index: 0, assetId: 'x' }, { index: 1, skip: true }] }, allowed).ok
    ).toBe(false)
  })
})

describe('readAsideConfig', () => {
  it('없거나 잘못된 설정은 리허설(자동 발행 끔)', () => {
    expect(readAsideConfig(null).autoPublish).toBe(false)
    expect(readAsideConfig({ aside: { autoPublish: 'yes' } }).autoPublish).toBe(false)
    expect(readAsideConfig({ aside: { autoPublish: true, blogId: 'b' } })).toMatchObject({
      autoPublish: true,
      blogId: 'b',
    })
  })
})
