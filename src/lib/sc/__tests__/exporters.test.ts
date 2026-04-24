import { exportBlogMarkdown } from '../exporters/blog-markdown'
import { exportSocialText } from '../exporters/social-text'
import { exportCardNews } from '../exporters/cardnews'

const doc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '제목입니다' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '이것은 ' },
        { type: 'text', text: '강조', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' 문단.' },
      ],
    },
    { type: 'imageSlot', attrs: { key: 'image1', label: '대표' } },
    { type: 'ctaSlot', attrs: { key: 'cta', label: '더 알아보기' } },
  ],
}

describe('exportBlogMarkdown', () => {
  it('heading → ##, bold → **, imageSlot/ctaSlot 치환', () => {
    const md = exportBlogMarkdown({
      doc,
      assets: [{ slotKey: 'image1', url: 'https://cdn/img1.png', alt: 'alt' }],
      deploymentUrl: 'https://app/c/abc12345',
    })
    expect(md).toContain('## 제목입니다')
    expect(md).toContain('**강조**')
    expect(md).toContain('![alt](https://cdn/img1.png)')
    expect(md).toContain('[더 알아보기](https://app/c/abc12345)')
  })
})

describe('exportSocialText', () => {
  it('CTA URL 말미 부착 + 길이 제한', () => {
    const text = exportSocialText({
      doc,
      assets: [],
      deploymentUrl: 'https://app/c/abc12345',
    })
    expect(text).toContain('제목입니다')
    expect(text).toContain('https://app/c/abc12345')
  })
})

describe('exportCardNews', () => {
  it('slide 를 index 순서로 정렬', () => {
    const slides = exportCardNews({
      doc: {
        type: 'doc',
        content: [
          {
            type: 'slide',
            attrs: { index: 1 },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '두번째' }] }],
          },
          {
            type: 'slide',
            attrs: { index: 0 },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '첫번째' }] }],
          },
        ],
      },
      assets: [],
    })
    expect(slides.map((s) => s.caption)).toEqual(['첫번째', '두번째'])
  })
})
