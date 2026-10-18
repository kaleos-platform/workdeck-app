import { textToDoc } from '../text-to-doc'

it('heading 과 paragraph 로 나누고 빈 줄은 버린다', () => {
  expect(textToDoc('# 제목\n\n첫 문단\n## 소제목\n둘째 문단  \n')).toEqual({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '제목' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '첫 문단' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '소제목' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '둘째 문단' }] },
    ],
  })
})

it('#### 이상이나 # 뒤 공백 없는 줄은 문단', () => {
  expect(textToDoc('#### 넷\n#해시태그').content!.map((n) => n.type)).toEqual([
    'paragraph',
    'paragraph',
  ])
})
