import { renderToStaticMarkup } from 'react-dom/server'
import { HomeContent } from '../home/home-content'

const html = (ids: string[]) => renderToStaticMarkup(<HomeContent releasedIds={ids} />)

describe('마케팅 홈 문구', () => {
  it('금지 단어가 없다', () => {
    const raw = html(['recruiting'])
    expect(raw).not.toContain('gradient')
    // 보이는 문구만 검사 — 브랜드명(워크덱)과 도메인(workdeck)은 제외
    const text = raw.replace(/<[^>]*>/g, ' ').replace(/워크덱|workdeck/gi, '')
    for (const word of ['전화', '상담', 'deck', '덱', '1~2일']) {
      expect(text).not.toContain(word)
    }
  })

  it('주 CTA 는 도입 문의 폼으로 가고 두 곳뿐이다', () => {
    const out = html(['recruiting'])
    expect(out.match(/href="[^"]*\/recruiting#lead-form"/g)).toHaveLength(2)
    expect(out).toContain('도입 문의하기')
  })

  it('released 업무가 큰 카드가 되고 나머지는 준비중이다', () => {
    const out = html(['recruiting'])
    expect(out).toContain('지금 사용 가능')
    expect(out).toContain('href="/recruiting"')
    expect(out).toContain('href="/finance#apply"')
    expect(out).not.toContain('href="/recruiting#apply"')
  })

  it('released 가 바뀌면 큰 카드도 바뀌고 이미지는 recruiting 일 때만 붙는다', () => {
    const out = html(['finance'])
    expect(out).toContain('href="/finance"')
    expect(out).toContain('href="/recruiting#apply"')
    // 히어로·AI 이미지 + (recruiting 큰 카드 이미지 없음)
    expect(out).not.toContain('editor.webp')
    expect(html(['recruiting'])).toContain('editor.webp')
  })

  it('두 번째 공개 업무는 준비중·출시 알림이 아니라 소개 링크다', () => {
    const out = html(['recruiting', 'finance'])
    expect(out).toContain('href="/finance"')
    expect(out).not.toContain('href="/finance#apply"')
    expect(out).toContain('href="/seller-hub#apply"')
  })
})
