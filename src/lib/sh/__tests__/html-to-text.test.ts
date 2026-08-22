import { htmlToText, HTML_TEXT_MAX_CHARS } from '../html-to-text'

describe('htmlToText 위험 블록 제거', () => {
  it('script 내용은 출력에 나타나지 않는다', () => {
    const { text } = htmlToText('<div>본문<script>alert(1)</script>더본문</div>')
    expect(text).not.toContain('alert')
    expect(text).toContain('본문')
    expect(text).toContain('더본문')
  })

  it('style 내용은 출력에 나타나지 않는다', () => {
    const { text } = htmlToText('<style>.a{color:red}</style><p>내용</p>')
    expect(text).not.toContain('color')
    expect(text).toContain('내용')
  })

  it('script 안에 </div> 문자열이 있어도 마크업이 새지 않는다', () => {
    const { text } = htmlToText('<div>앞<script>var s = "</div>";</script>뒤</div>')
    expect(text).not.toContain('<div>')
    expect(text).not.toContain('var s')
    expect(text).toContain('앞')
    expect(text).toContain('뒤')
  })
})

describe('htmlToText 메타데이터 추출', () => {
  it('title/og:title/og:description/description을 추출한다', () => {
    const html = `
      <html><head>
        <title>페이지 타이틀</title>
        <meta property="og:title" content="오지 타이틀">
        <meta property="og:description" content="오지 설명">
        <meta name="description" content="일반 설명">
      </head><body>본문</body></html>
    `
    const { title, text } = htmlToText(html)
    expect(title).toBe('오지 타이틀')
    expect(text).toContain('제목: 오지 타이틀')
    expect(text).toContain('요약: 오지 설명')
  })

  it('content 속성이 property/name보다 먼저 나와도 추출한다', () => {
    const html = `<meta content="선순위 설명" property="og:description">`
    const { text } = htmlToText(html)
    expect(text).toContain('요약: 선순위 설명')
  })

  it('og:title이 있으면 <title>보다 우선한다', () => {
    const html = `<title>일반 타이틀</title><meta property="og:title" content="오지 우선">`
    const { title } = htmlToText(html)
    expect(title).toBe('오지 우선')
  })

  it('og:title이 없으면 <title>을 사용한다', () => {
    const html = `<title>일반 타이틀만 있음</title>`
    const { title } = htmlToText(html)
    expect(title).toBe('일반 타이틀만 있음')
  })

  it('메타가 전혀 없으면 title은 null', () => {
    const { title } = htmlToText('<div>본문만 있음</div>')
    expect(title).toBeNull()
  })

  it('head 블록이 제거되기 전에 메타데이터를 추출한다', () => {
    const html = `<head><title>헤드 타이틀</title></head><body>본문</body>`
    const { title, text } = htmlToText(html)
    expect(title).toBe('헤드 타이틀')
    expect(text).not.toContain('<head>')
  })
})

describe('htmlToText img alt 승격', () => {
  it('의미 있는 alt는 인라인으로 승격된다', () => {
    const { text } = htmlToText('<img src="a.jpg" alt="쿨메쉬 심리스 커버">')
    expect(text).toContain('쿨메쉬 심리스 커버')
  })

  it('빈 alt는 승격하지 않는다', () => {
    const { text } = htmlToText('<p>내용</p><img src="a.jpg" alt="">')
    expect(text.trim()).toBe('내용')
  })

  it('노이즈 alt(이미지/image/파일명)는 승격하지 않는다', () => {
    const { text } = htmlToText(
      '<img alt="이미지"><img alt="image"><img alt="image.jpg"><p>진짜내용</p>'
    )
    expect(text).not.toContain('이미지')
    expect(text).not.toContain('image')
    expect(text).toContain('진짜내용')
  })
})

describe('htmlToText 블록 → 줄바꿈 변환', () => {
  it('br, /p, /li가 줄바꿈을 만든다', () => {
    const { text } = htmlToText('<p>첫줄</p><p>둘째<br>줄</p><ul><li>항목1</li><li>항목2</li></ul>')
    const lines = text.split('\n')
    expect(lines).toContain('첫줄')
    expect(lines).toContain('둘째')
    expect(lines).toContain('줄')
    expect(lines).toContain('- 항목1')
    expect(lines).toContain('- 항목2')
  })
})

describe('htmlToText 엔티티 디코딩', () => {
  it('&amp; &nbsp; &#39; &#x27; &lt;div&gt; 를 디코딩한다', () => {
    const { text } = htmlToText('<p>A&amp;B&nbsp;C&#39;D&#x27;E&lt;div&gt;</p>')
    expect(text).toContain("A&B C'D'E<div>")
  })
})

describe('htmlToText 공백 정규화', () => {
  it('3줄 이상 빈 줄은 2줄로 축소된다', () => {
    const { text } = htmlToText('<p>가</p><br><br><br><br><p>나</p>')
    expect(text).not.toMatch(/\n{3,}/)
    expect(text).toContain('가\n\n나')
  })
})

describe('htmlToText 절삭', () => {
  it('maxChars를 넘으면 잘리고 truncated가 true', () => {
    const longText = '가'.repeat(100)
    const { text, truncated } = htmlToText(`<p>${longText}</p>`, 50)
    expect(truncated).toBe(true)
    expect(text.length).toBeLessThanOrEqual(50)
  })

  it('기본 maxChars는 HTML_TEXT_MAX_CHARS이고 짧은 입력은 잘리지 않는다', () => {
    const { truncated } = htmlToText('<p>짧은 본문</p>')
    expect(truncated).toBe(false)
    expect(HTML_TEXT_MAX_CHARS).toBe(30000)
  })
})

describe('htmlToText 카페24 스타일 실제 상세페이지 조각', () => {
  it('상품 카피가 살아남는다', () => {
    const html = `
      <!doctype html>
      <html>
      <head>
        <title>[단독] 쿨메쉬 심리스 브라 - 워크덱</title>
        <meta property="og:title" content="쿨메쉬 심리스 브라">
        <meta property="og:description" content="시원한 착용감의 논와이어 브라">
        <script>ga('send', 'pageview');</script>
        <style>body{margin:0}</style>
      </head>
      <body>
        <!-- 상단 배너 -->
        <div class="header">워크덱 스토어</div>
        <div class="detail_page">
          <img src="//img.example.com/main.jpg" alt="쿨메쉬 심리스 브라 메인 이미지">
          <p>땀에 강한 쿨메쉬 소재로 여름철에도 산뜻하게 착용할 수 있습니다.</p>
          <ul>
            <li>소재: 나일론 80% 스판덱스 20%</li>
            <li>사이즈: S/M/L</li>
          </ul>
          <img src="//img.example.com/detail1.jpg" alt="image.jpg">
          <div>
            <table>
              <tr><td>제조국</td><td>대한민국</td></tr>
            </table>
          </div>
          <script>console.log("</div> 로 마크업이 새면 안됨")</script>
        </div>
      </body>
      </html>
    `
    const { title, text, truncated } = htmlToText(html)

    expect(title).toBe('쿨메쉬 심리스 브라')
    expect(truncated).toBe(false)
    expect(text).toContain('제목: 쿨메쉬 심리스 브라')
    expect(text).toContain('요약: 시원한 착용감의 논와이어 브라')
    expect(text).toContain('쿨메쉬 심리스 브라 메인 이미지')
    expect(text).toContain('땀에 강한 쿨메쉬 소재로 여름철에도 산뜻하게 착용할 수 있습니다.')
    expect(text).toContain('- 소재: 나일론 80% 스판덱스 20%')
    expect(text).toContain('- 사이즈: S/M/L')
    expect(text).toContain('제조국')
    expect(text).toContain('대한민국')
    expect(text).not.toContain('console.log')
    expect(text).not.toContain('ga(')
    expect(text).not.toContain('margin:0')
    expect(text).not.toContain('image.jpg')
  })
})
