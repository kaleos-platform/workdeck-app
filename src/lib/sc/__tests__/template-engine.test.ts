import { sectionsSchemaForKind, renderSkeleton, SYSTEM_TEMPLATES } from '../template-engine'

describe('sectionsSchemaForKind', () => {
  it('BLOG: sections 배열 필수', () => {
    const ok = sectionsSchemaForKind('BLOG').safeParse({
      sections: [{ key: 'title', kind: 'text', label: '제목' }],
    })
    expect(ok.success).toBe(true)
  })

  it('BLOG: section.key 규칙 위반 시 실패', () => {
    const bad = sectionsSchemaForKind('BLOG').safeParse({
      sections: [{ key: '1title', kind: 'text', label: '제목' }],
    })
    expect(bad.success).toBe(false)
  })

  it('CARDNEWS: slides 배열 필수', () => {
    const ok = sectionsSchemaForKind('CARDNEWS').safeParse({
      slides: [
        {
          index: 0,
          sections: [{ key: 'title', kind: 'text', label: 'title' }],
        },
      ],
    })
    expect(ok.success).toBe(true)
  })

  it('CARDNEWS 에 BLOG 구조 전달 시 실패', () => {
    const bad = sectionsSchemaForKind('CARDNEWS').safeParse({
      sections: [{ key: 'title', kind: 'text', label: 'title' }],
    })
    expect(bad.success).toBe(false)
  })
})

describe('renderSkeleton', () => {
  it('BLOG: section 을 doc.content 에 순서대로 변환', () => {
    const result = renderSkeleton('BLOG', {
      sections: [
        { key: 'title', kind: 'text', label: '제목' },
        { key: 'image1', kind: 'imageSlot', label: '이미지' },
        { key: 'cta', kind: 'cta', label: '행동 유도' },
      ],
    })
    expect(result.doc.type).toBe('doc')
    expect(result.doc.content).toHaveLength(3)
    expect(result.doc.content?.[0].type).toBe('paragraph')
    expect(result.doc.content?.[1].type).toBe('imageSlot')
    expect(result.doc.content?.[2].type).toBe('ctaSlot')
    expect(result.slotMap).toHaveLength(3)
  })

  it('CARDNEWS: slide index 순서로 정렬', () => {
    const result = renderSkeleton('CARDNEWS', {
      slides: [
        {
          index: 2,
          sections: [{ key: 'caption', kind: 'text', label: 'c' }],
        },
        {
          index: 0,
          sections: [{ key: 'title', kind: 'text', label: 't' }],
        },
      ],
    })
    expect(result.doc.content?.[0].attrs?.index).toBe(0)
    expect(result.doc.content?.[1].attrs?.index).toBe(2)
  })
})

describe('SYSTEM_TEMPLATES', () => {
  it('3종이 정의되고 각자 유효한 sections 구조를 갖는다', () => {
    expect(SYSTEM_TEMPLATES).toHaveLength(3)
    for (const t of SYSTEM_TEMPLATES) {
      const parsed = sectionsSchemaForKind(t.kind).safeParse(t.sections)
      expect(parsed.success).toBe(true)
    }
  })
})
