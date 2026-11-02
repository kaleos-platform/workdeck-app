import { exportNaverPost, INQUIRY_LINK_TOKEN } from '../exporters/naver-post'
import { textToDoc } from '../text-to-doc'

describe('exportNaverPost', () => {
  const doc = textToDoc(`# 제목\n본문 <b>굵게</b>\n문의: ${INQUIRY_LINK_TOKEN}`)

  it('소제목과 문단을 HTML 로 만들고 입력을 이스케이프한다', () => {
    const { html } = exportNaverPost({ doc })
    expect(html).toContain('<h1>제목</h1>')
    expect(html).toContain('본문 &lt;b&gt;굵게&lt;/b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('배포 링크가 있으면 문의 토큰을 HTML·평문 모두 추적 링크로 바꾼다', () => {
    const url = 'https://app.workdeck.work/c/abc'
    const { html, text } = exportNaverPost({ doc, deploymentUrl: url })
    expect(html).toContain(`<a href="${url}">${url}</a>`)
    expect(text).toContain(`문의: ${url}`)
    expect(text).not.toContain(INQUIRY_LINK_TOKEN)
  })

  it('배포 링크가 없으면 토큰을 그대로 둔다', () => {
    expect(exportNaverPost({ doc }).text).toContain(INQUIRY_LINK_TOKEN)
  })

  it('http(s) 가 아닌 이미지는 버린다', () => {
    const { html } = exportNaverPost({
      doc: {
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: 'javascript:alert(1)' } },
          { type: 'image', attrs: { src: 'https://a.test/x.png' } },
        ],
      },
    })
    expect(html).not.toContain('javascript')
    expect(html).toContain('https://a.test/x.png')
  })

  it('서식이 토큰을 나눠도 추적 링크로 바꾼다', () => {
    const { html } = exportNaverPost({
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '[문의', marks: [{ type: 'bold' }] },
              { type: 'text', text: ' 링크]' },
            ],
          },
        ],
      },
      deploymentUrl: 'https://a.test/c/x',
    })
    expect(html).toContain('<a href="https://a.test/c/x">')
    expect(html).not.toContain('[문의')
  })

  it('굵게·링크를 유지하고 위험한 링크는 버린다', () => {
    const { html } = exportNaverPost({
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '굵게', marks: [{ type: 'bold' }] },
              {
                type: 'text',
                text: '좋은',
                marks: [{ type: 'link', attrs: { href: 'https://a.test' } }],
              },
              {
                type: 'text',
                text: '나쁜',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      },
    })
    expect(html).toContain('<strong>굵게</strong>')
    expect(html).toContain('<a href="https://a.test">좋은</a>')
    expect(html).not.toContain('javascript')
  })

  it('잘못된 문서 모양에도 실패하지 않는다', () => {
    expect(exportNaverPost({ doc: { content: {} } })).toEqual({ html: '', text: '' })
  })
})
