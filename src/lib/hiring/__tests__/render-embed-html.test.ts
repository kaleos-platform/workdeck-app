import { renderPostingEmbed, renderPostingEmbedHtml } from '../render-embed-html'

describe('외부 공고 HTML', () => {
  it('앱 CSS 없이 제목·목록 스타일과 사용자 정렬을 유지한다', () => {
    const html = renderPostingEmbedHtml({
      origin: 'https://workdeck.test',
      posting: {
        uuid: 'test',
        positions: [],
        contents: [
          {
            contentType: 'text',
            imagePath: null,
            data: {
              type: 'doc',
              content: [
                {
                  type: 'heading',
                  attrs: { level: 2 },
                  content: [{ type: 'text', text: '모집 안내' }],
                },
                {
                  type: 'paragraph',
                  attrs: { textAlign: 'center' },
                  content: [{ type: 'text', text: '지원 조건' }],
                },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        { type: 'paragraph', content: [{ type: 'text', text: '경력 무관' }] },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    })
    const root = document.createElement('div')
    root.innerHTML = html
    expect(root.querySelector('h2')?.style.fontSize).toBe('20px')
    expect(root.querySelector('h2')?.style.fontWeight).toBe('600')
    expect(root.querySelector('p')?.style.textAlign).toBe('center')
    expect(root.querySelector('p')?.style.marginBottom).toBe('8px')
    expect(root.querySelector('ul')?.style.listStyleType).toBe('disc')
    expect(root.querySelector('ul')?.style.paddingLeft).toBe('20px')
  })
})

it('잘못된 외부 버튼 URL을 지원서 링크로 바꾸지 않는다', () => {
  const html = renderPostingEmbedHtml({
    origin: 'https://workdeck.test',
    posting: {
      uuid: 'qa',
      positions: [],
      contents: [
        {
          contentType: 'button',
          imagePath: null,
          data: { title: '상세 확인', linkType: 'url', url: '' },
        },
      ],
    },
  })
  expect(html).not.toContain('/apply')
  expect(html).not.toContain('<a ')
})

it('기존 데이터의 위험한 URL을 외부 HTML에 내보내지 않는다', () => {
  const html = renderPostingEmbedHtml({
    origin: 'https://workdeck.test',
    posting: {
      uuid: 'qa',
      positions: [],
      contents: [
        {
          contentType: 'button',
          imagePath: null,
          data: { title: '상세 확인', linkType: 'url', url: 'javascript:alert(1)' },
        },
      ],
    },
  })
  expect(html).not.toContain('javascript:')
})

it('누락 이미지와 변환 실패를 카드 번호와 함께 보고한다', () => {
  const result = renderPostingEmbed({
    origin: 'https://workdeck.test',
    posting: {
      uuid: 'qa',
      positions: [],
      contents: [
        { contentType: 'image', imagePath: null, data: null },
        { contentType: 'design', imagePath: null, data: { elements: [] } },
        { contentType: 'text', imagePath: null, data: { type: 'unknown-node' } },
      ],
    },
  })
  expect(result.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ blockNumber: 1, severity: 'error' }),
      expect.objectContaining({ blockNumber: 2, severity: 'error' }),
      expect.objectContaining({ blockNumber: 3, severity: 'error' }),
      expect.objectContaining({ blockNumber: 0, severity: 'error' }),
    ])
  )
})

it('대표 블록 조합을 누락 없이 렌더하고 지원서 연결을 표시한다', () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://assets.workdeck.test'
  try {
    const result = renderPostingEmbed({
      origin: 'https://workdeck.test',
      posting: {
        uuid: 'qa',
        positions: [
          {
            name: '매장 직원',
            jobType: 'PART_TIME',
            payFrequency: 'HOURLY',
            payAmount: 12000,
            workDays: [1, 3],
            workStartAt: '09:00',
            workEndAt: '18:00',
            headcount: 1,
            experience: null,
            education: null,
            jobDescription: '근무 안내',
          },
        ],
        contents: [
          {
            contentType: 'text',
            imagePath: null,
            data: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '모집 안내', marks: [{ type: 'bold' }] }],
                },
              ],
            },
          },
          {
            contentType: 'image',
            imagePath: 'qa/photo.png',
            data: { link: { linkType: 'url', url: 'https://example.com/jobs' } },
          },
          { contentType: 'design', imagePath: 'qa/design.png', data: { elements: [] } },
          { contentType: 'button', imagePath: null, data: { title: '지원하기', linkType: 'form' } },
          { contentType: 'positions', imagePath: null, data: null },
        ],
      },
    })
    expect(result.issues).toEqual([])
    expect(result.usesFormLink).toBe(true)
    const root = document.createElement('div')
    root.innerHTML = result.html
    expect(root.querySelectorAll('img')).toHaveLength(2)
    expect(root.querySelector('strong')).toHaveTextContent('모집 안내')
    expect(root.querySelector('a[href="https://workdeck.test/p/qa/apply"]')).toHaveTextContent(
      '지원하기'
    )
    expect(root.textContent).toContain('매장 직원')
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous
  }
})

it('본문 내부의 잘못된 링크도 출력 전에 검출한다', () => {
  const result = renderPostingEmbed({
    origin: 'https://workdeck.test',
    posting: {
      uuid: 'qa',
      positions: [],
      contents: [
        {
          contentType: 'text',
          imagePath: null,
          data: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: '링크',
                    marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  })
  expect(result.issues[0]).toMatchObject({ blockNumber: 1, severity: 'error' })
  expect(result.html).not.toContain('javascript:')
})
