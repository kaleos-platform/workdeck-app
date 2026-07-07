// @jest-environment node
import { renderTiptapHtml } from '../render-tiptap'

const SAMPLE_DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '안녕' }],
    },
  ],
}

describe('renderTiptapHtml', () => {
  it('paragraph 노드를 <p> 태그로 변환한다', () => {
    const html = renderTiptapHtml(SAMPLE_DOC)
    expect(html).toContain('<p>안녕</p>')
  })

  it('잘못된 doc은 빈 문자열을 반환한다', () => {
    const html = renderTiptapHtml(null)
    expect(html).toBe('')
  })
})
