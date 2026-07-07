import { markdownToTipTapDoc, parseInline } from '../markdown-to-doc'

// ─── parseInline 단위 테스트 ─────────────────────────────────────────────────

describe('parseInline', () => {
  it('일반 텍스트를 text 노드로 변환한다', () => {
    const result = parseInline('안녕하세요')
    expect(result).toEqual([{ type: 'text', text: '안녕하세요' }])
  })

  it('**bold** 를 bold 마크로 변환한다', () => {
    const result = parseInline('**굵게**')
    expect(result).toEqual([{ type: 'text', text: '굵게', marks: [{ type: 'bold' }] }])
  })

  it('*italic* 를 italic 마크로 변환한다', () => {
    const result = parseInline('*기울임*')
    expect(result).toEqual([{ type: 'text', text: '기울임', marks: [{ type: 'italic' }] }])
  })

  it('***bold+italic*** 을 bold+italic 마크 조합으로 변환한다', () => {
    const result = parseInline('***굵기+기울임***')
    expect(result).toEqual([
      { type: 'text', text: '굵기+기울임', marks: [{ type: 'bold' }, { type: 'italic' }] },
    ])
  })

  it('[text](url) 을 link 마크로 변환한다', () => {
    const result = parseInline('[클릭](https://example.com)')
    expect(result).toEqual([
      {
        type: 'text',
        text: '클릭',
        marks: [
          {
            type: 'link',
            attrs: {
              href: 'https://example.com',
              target: '_blank',
              rel: 'noopener noreferrer nofollow',
              class: null,
            },
          },
        ],
      },
    ])
  })

  it('**bold** 와 일반 텍스트가 혼합된 경우 각각 별도 노드로 변환한다', () => {
    const result = parseInline('앞 **굵게** 뒤')
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ type: 'text', text: '앞 ' })
    expect(result[1]).toEqual({ type: 'text', text: '굵게', marks: [{ type: 'bold' }] })
    expect(result[2]).toEqual({ type: 'text', text: ' 뒤' })
  })

  it('빈 문자열은 빈 배열을 반환한다', () => {
    expect(parseInline('')).toEqual([])
  })
})

// ─── markdownToTipTapDoc 단위 테스트 ─────────────────────────────────────────

describe('markdownToTipTapDoc', () => {
  it('빈 문자열은 content가 빈 doc을 반환한다', () => {
    const doc = markdownToTipTapDoc('')
    expect(doc).toEqual({ type: 'doc', content: [] })
  })

  it('## 헤딩을 level 2 heading 노드로 변환한다', () => {
    const doc = markdownToTipTapDoc('## 섹션 제목')
    expect(doc.content).toHaveLength(1)
    expect(doc.content[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '섹션 제목' }],
    })
  })

  it('### 헤딩을 level 3 heading 노드로 변환한다', () => {
    const doc = markdownToTipTapDoc('### 하위 섹션')
    expect(doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 3 } })
  })

  it('일반 줄을 paragraph 노드로 변환한다', () => {
    const doc = markdownToTipTapDoc('일반 텍스트입니다.')
    expect(doc.content[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: '일반 텍스트입니다.' }],
    })
  })

  it('불릿 리스트를 bulletList > listItem > paragraph 구조로 변환한다', () => {
    const doc = markdownToTipTapDoc('- 항목 A\n- 항목 B')
    expect(doc.content).toHaveLength(1)
    const list = doc.content[0]
    expect(list.type).toBe('bulletList')
    expect(list.content).toHaveLength(2)
    // listItem은 반드시 paragraph로 래핑
    expect(list.content?.[0]).toMatchObject({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '항목 A' }] }],
    })
  })

  it('순서 있는 리스트를 orderedList > listItem > paragraph 구조로 변환한다', () => {
    const doc = markdownToTipTapDoc('1. 첫 번째\n2. 두 번째')
    expect(doc.content[0].type).toBe('orderedList')
    expect(doc.content[0].attrs).toMatchObject({ start: 1 })
    expect(doc.content[0].content).toHaveLength(2)
    expect(doc.content[0].content?.[0]).toMatchObject({
      type: 'listItem',
      content: [{ type: 'paragraph' }],
    })
  })

  it('인용구를 blockquote > paragraph 구조로 변환한다', () => {
    const doc = markdownToTipTapDoc('> 인용된 텍스트')
    expect(doc.content[0]).toMatchObject({
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '인용된 텍스트' }] }],
    })
  })

  it('코드 블록을 codeBlock 노드로 변환한다 — text를 직접 담고 paragraph 없음', () => {
    const md = '```javascript\nconsole.log("hello")\n```'
    const doc = markdownToTipTapDoc(md)
    expect(doc.content[0]).toMatchObject({
      type: 'codeBlock',
      attrs: { language: 'javascript' },
      content: [{ type: 'text', text: 'console.log("hello")' }],
    })
  })

  it('언어 없는 코드 블록은 language: null로 변환한다', () => {
    const doc = markdownToTipTapDoc('```\ncode here\n```')
    expect(doc.content[0]).toMatchObject({ type: 'codeBlock', attrs: { language: null } })
  })

  it('빈 줄로 구분된 여러 단락을 각각 paragraph 노드로 변환한다', () => {
    const doc = markdownToTipTapDoc('첫 번째 단락\n\n두 번째 단락')
    expect(doc.content).toHaveLength(2)
    expect(doc.content[0].type).toBe('paragraph')
    expect(doc.content[1].type).toBe('paragraph')
  })

  it('헤딩 + 단락 혼합을 순서대로 변환한다', () => {
    const md = ['## 제목', '', '본문 내용', '', '### 소제목', '', '소본문'].join('\n')
    const doc = markdownToTipTapDoc(md)
    expect(doc.content.map((n) => n.type)).toEqual(['heading', 'paragraph', 'heading', 'paragraph'])
  })

  it('단락 내 인라인 마크를 포함한 경우 올바른 marks 배열을 가진다', () => {
    const doc = markdownToTipTapDoc('이것은 **굵게** 그리고 *기울임*입니다.')
    const para = doc.content[0]
    expect(para.type).toBe('paragraph')
    // content에 text 노드 여러 개 포함
    const nodes = para.content ?? []
    const boldNode = nodes.find((n) => 'marks' in n && n.marks?.some((m) => m.type === 'bold'))
    expect(boldNode).toBeDefined()
  })
})
