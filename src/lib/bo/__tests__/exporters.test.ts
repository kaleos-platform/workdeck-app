// docToMarkdown / docToHtml 라운드트립 테스트
// markdownToTipTapDoc(canonicalMd) → docToMarkdown → markdownToTipTapDoc 동등성 검증

import { markdownToTipTapDoc } from '@/lib/bo/markdown-to-doc'
import { docToMarkdown } from '@/lib/bo/exporters/markdown'
import { docToHtml } from '@/lib/bo/exporters/html'

// ─── 라운드트립 헬퍼 ──────────────────────────────────────────────────────────

/** MD → doc → MD → doc 이 동일한 doc을 반환하는지 검증 */
function roundTripMd(md: string) {
  const doc = markdownToTipTapDoc(md)
  const exported = docToMarkdown(doc)
  const docAgain = markdownToTipTapDoc(exported)
  return { doc, exported, docAgain }
}

// ─── Markdown 라운드트립 ──────────────────────────────────────────────────────

describe('docToMarkdown — 라운드트립', () => {
  test('헤딩 H1~H3', () => {
    const md = '# 제목 1\n\n## 제목 2\n\n### 제목 3'
    const { doc, docAgain } = roundTripMd(md)
    expect(docAgain).toEqual(doc)
  })

  test('단락', () => {
    const md = '안녕하세요.\n\n두 번째 단락입니다.'
    const { doc, docAgain } = roundTripMd(md)
    expect(docAgain).toEqual(doc)
  })

  test('볼드 텍스트', () => {
    const md = '**굵은 글씨** 입니다.'
    const { doc, docAgain } = roundTripMd(md)
    expect(docAgain).toEqual(doc)
  })

  test('이탤릭 텍스트', () => {
    const md = '*기울임* 텍스트.'
    const { doc, docAgain } = roundTripMd(md)
    expect(docAgain).toEqual(doc)
  })

  test('링크', () => {
    const md = '[워크덱](https://workdeck.com) 바로가기.'
    const { doc, docAgain } = roundTripMd(md)
    expect(docAgain).toEqual(doc)
  })

  test('불릿 리스트', () => {
    const md = '- 항목 A\n- 항목 B\n- 항목 C'
    const { doc, docAgain } = roundTripMd(md)
    expect(docAgain).toEqual(doc)
  })

  test('순서 있는 리스트', () => {
    const md = '1. 첫 번째\n2. 두 번째\n3. 세 번째'
    const { doc, docAgain } = roundTripMd(md)
    expect(docAgain).toEqual(doc)
  })

  test('인용구', () => {
    const md = '> 인용구 내용입니다.'
    const { doc, docAgain } = roundTripMd(md)
    expect(docAgain).toEqual(doc)
  })

  test('코드 블록 (언어 없음)', () => {
    const md = '```\nconsole.log("hello")\n```'
    const { doc, docAgain } = roundTripMd(md)
    expect(docAgain).toEqual(doc)
  })

  test('코드 블록 (언어 지정)', () => {
    const md = '```typescript\nconst x: number = 42\n```'
    const { doc, docAgain } = roundTripMd(md)
    expect(docAgain).toEqual(doc)
  })

  test('혼합 문서 — 헤딩 + 단락 + 리스트', () => {
    const md = [
      '## 섹션 제목',
      '',
      '단락 내용이 여기 들어갑니다.',
      '',
      '- 항목 1',
      '- 항목 2',
    ].join('\n')
    const { doc, docAgain } = roundTripMd(md)
    expect(docAgain).toEqual(doc)
  })
})

// ─── Markdown 직접 출력 검증 ──────────────────────────────────────────────────

describe('docToMarkdown — 직접 출력', () => {
  test('헤딩 레벨 보존', () => {
    const doc = markdownToTipTapDoc('## 레벨 2')
    expect(docToMarkdown(doc)).toBe('## 레벨 2')
  })

  test('코드 블록 언어 태그 포함', () => {
    const doc = markdownToTipTapDoc('```js\nconst x = 1\n```')
    const md = docToMarkdown(doc)
    expect(md).toMatch(/^```js/)
    expect(md).toContain('const x = 1')
    expect(md).toMatch(/```$/)
  })

  test('인용구 > 접두사 포함', () => {
    const doc = markdownToTipTapDoc('> 인용 내용')
    expect(docToMarkdown(doc)).toMatch(/^> /)
  })

  test('볼드 링크 조합', () => {
    const doc = markdownToTipTapDoc('[**굵은 링크**](https://example.com)')
    const md = docToMarkdown(doc)
    // 볼드와 링크가 모두 포함되어야 함
    expect(md).toContain('**')
    expect(md).toContain('https://example.com')
  })
})

// ─── HTML 출력 검증 ───────────────────────────────────────────────────────────

describe('docToHtml — 출력 검증', () => {
  test('헤딩 → <h2> 태그', () => {
    const doc = markdownToTipTapDoc('## 섹션')
    expect(docToHtml(doc)).toBe('<h2>섹션</h2>')
  })

  test('단락 → <p> 태그', () => {
    const doc = markdownToTipTapDoc('내용입니다.')
    expect(docToHtml(doc)).toBe('<p>내용입니다.</p>')
  })

  test('볼드 → <strong>', () => {
    const doc = markdownToTipTapDoc('**볼드**')
    expect(docToHtml(doc)).toContain('<strong>볼드</strong>')
  })

  test('이탤릭 → <em>', () => {
    const doc = markdownToTipTapDoc('*이탤릭*')
    expect(docToHtml(doc)).toContain('<em>이탤릭</em>')
  })

  test('링크 → <a href>', () => {
    const doc = markdownToTipTapDoc('[클릭](https://example.com)')
    const html = docToHtml(doc)
    expect(html).toContain('<a href="https://example.com"')
    expect(html).toContain('클릭')
  })

  test('불릿 리스트 → <ul><li>', () => {
    const doc = markdownToTipTapDoc('- A\n- B')
    const html = docToHtml(doc)
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>A</li>')
    expect(html).toContain('<li>B</li>')
  })

  test('순서 리스트 → <ol><li>', () => {
    const doc = markdownToTipTapDoc('1. 첫째\n2. 둘째')
    const html = docToHtml(doc)
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>첫째</li>')
  })

  test('인용구 → <blockquote><p>', () => {
    const doc = markdownToTipTapDoc('> 인용')
    expect(docToHtml(doc)).toBe('<blockquote><p>인용</p></blockquote>')
  })

  test('코드 블록 → <pre><code class="language-js">', () => {
    const doc = markdownToTipTapDoc('```js\nlet x = 1\n```')
    const html = docToHtml(doc)
    expect(html).toContain('<pre><code class="language-js">')
    expect(html).toContain('let x = 1')
  })

  test('HTML 특수문자 이스케이프 — 텍스트', () => {
    const doc = markdownToTipTapDoc('5 > 3 & 10 < 20')
    const html = docToHtml(doc)
    expect(html).toContain('&gt;')
    expect(html).toContain('&lt;')
    expect(html).toContain('&amp;')
    expect(html).not.toContain('<20')
  })

  test('코드 블록 HTML 이스케이프', () => {
    const doc = markdownToTipTapDoc('```\n<script>alert(1)</script>\n```')
    const html = docToHtml(doc)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
