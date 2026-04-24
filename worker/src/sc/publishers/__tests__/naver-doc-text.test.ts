import { renderDocToPlainText } from '../_naver-doc-text.js'

describe('renderDocToPlainText', () => {
  it('단일 문단', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '안녕하세요' }] }],
    }
    const out = renderDocToPlainText(doc, 'https://wdk.app/c/abc')
    expect(out).toBe('안녕하세요\n\n\n자세히 보기: https://wdk.app/c/abc')
  })

  it('여러 문단 + heading 은 개행 2줄로 구분', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '제목' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '첫 문단' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '두 번째 문단' }] },
      ],
    }
    const out = renderDocToPlainText(doc, 'https://x.y/z')
    expect(out).toBe('제목\n\n첫 문단\n\n두 번째 문단\n\n\n자세히 보기: https://x.y/z')
  })

  it('중첩 마크(bold 등) 내부 텍스트도 수집', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '앞 ' },
            { type: 'text', text: '강조', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' 뒤' },
          ],
        },
      ],
    }
    expect(renderDocToPlainText(doc, '')).toBe('앞 강조 뒤')
  })

  it('빈 문단은 건너뛴다', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: '내용' }] },
        { type: 'paragraph', content: [] },
      ],
    }
    expect(renderDocToPlainText(doc, '')).toBe('내용')
  })

  it('deploymentUrl 빈 문자열이면 CTA 블록 없음', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
    }
    expect(renderDocToPlainText(doc, '')).toBe('x')
  })

  it('잘못된 입력(null/undefined)은 CTA 만 반환하거나 빈 문자열', () => {
    expect(renderDocToPlainText(null, '')).toBe('')
    expect(renderDocToPlainText(undefined, 'https://x/')).toBe('\n\n\n자세히 보기: https://x/')
  })
})
