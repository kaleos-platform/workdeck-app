import { readFileSync } from 'fs'
import { join } from 'path'
import { htmlToText, HTML_TEXT_MAX_CHARS, MAX_IMAGE_URLS } from '../html-to-text'

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

describe('htmlToText JSON-LD 구조화 데이터 추출', () => {
  it('Product 블록에서 name/description/brand/offers/image를 뽑는다', () => {
    const html = `
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"테스트 상품",
       "description":"테스트 설명","brand":{"@type":"Brand","name":"테스트 브랜드"},
       "offers":[{"name":"테스트 상품 - S","price":10000,"priceCurrency":"KRW","availability":"InStock"}],
       "image":["https://img.example.com/a.jpg"]}
      </script>
    `
    const { structured, text } = htmlToText(html)
    expect(structured).not.toBeNull()
    expect(structured?.name).toBe('테스트 상품')
    expect(structured?.description).toBe('테스트 설명')
    expect(structured?.brand).toBe('테스트 브랜드')
    expect(structured?.offers).toEqual([
      { name: '테스트 상품 - S', price: 10000, priceCurrency: 'KRW', availability: 'InStock' },
    ])
    expect(structured?.images).toEqual(['https://img.example.com/a.jpg'])
    // 구조화 요약이 본문 맨 앞부분에 온다
    expect(text.indexOf('[상품 구조화 정보]')).toBeLessThan(text.indexOf('테스트 상품 - S'))
  })

  it('@graph 배열 안의 Product 노드도 찾는다', () => {
    const html = `
      <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"BreadcrumbList","itemListElement":[]},
        {"@type":"Product","name":"그래프 안 상품"}
      ]}
      </script>
    `
    const { structured } = htmlToText(html)
    expect(structured?.name).toBe('그래프 안 상품')
  })

  it('깨진 JSON-LD는 조용히 건너뛰고 전체를 죽이지 않는다', () => {
    const html = `
      <script type="application/ld+json">{ 이건 JSON이 아님 }</script>
      <p>본문은 살아있다</p>
    `
    const { structured, text } = htmlToText(html)
    expect(structured).toBeNull()
    expect(text).toContain('본문은 살아있다')
  })

  it('Product 타입이 없으면 structured는 null', () => {
    const html = `<script type="application/ld+json">{"@type":"WebSite","name":"사이트"}</script>`
    const { structured } = htmlToText(html)
    expect(structured).toBeNull()
  })
})

describe('htmlToText 이미지 URL 수집', () => {
  it('ec-data-src/data-src 등 지연로딩 속성을 절대 URL로 수집한다', () => {
    const html = `
      <div id="prdDetail">
        <img ec-data-src="//img.example.com/detail1.jpg">
        <img data-src="/rel/detail2.jpg">
      </div>
    `
    const { imageUrls } = htmlToText(html, undefined, { baseUrl: 'https://shop.example.com/p/1' })
    expect(imageUrls).toContain('https://img.example.com/detail1.jpg')
    expect(imageUrls).toContain('https://shop.example.com/rel/detail2.jpg')
  })

  it('base URL이 없으면 상대경로는 절대화하지 못해 제외된다', () => {
    const html = `<div id="prdDetail"><img data-src="/rel/detail.jpg"></div>`
    const { imageUrls } = htmlToText(html)
    expect(imageUrls).toEqual([])
  })

  it('아이콘/로고/배너/썸네일 경로는 제외한다', () => {
    const html = `
      <div id="prdDetail">
        <img src="https://img.example.com/icon_search.svg">
        <img src="https://img.example.com/logo.png">
        <img src="https://img.example.com/product/small/a.jpg">
        <img src="https://img.example.com/product/big/a.jpg">
      </div>
    `
    const { imageUrls } = htmlToText(html)
    expect(imageUrls).not.toContain('https://img.example.com/icon_search.svg')
    expect(imageUrls).not.toContain('https://img.example.com/logo.png')
    expect(imageUrls).not.toContain('https://img.example.com/product/small/a.jpg')
    expect(imageUrls).toContain('https://img.example.com/product/big/a.jpg')
  })

  it('MAX_IMAGE_URLS개를 넘지 않는다', () => {
    const imgs = Array.from(
      { length: 20 },
      (_, i) => `<img src="https://img.example.com/detail${i}.jpg">`
    ).join('')
    const html = `<div id="prdDetail">${imgs}</div>`
    const { imageUrls } = htmlToText(html)
    expect(imageUrls.length).toBe(MAX_IMAGE_URLS)
  })

  it('중복 URL은 한 번만 담긴다', () => {
    const html = `
      <div id="prdDetail">
        <img src="https://img.example.com/a.jpg">
        <img ec-data-src="https://img.example.com/a.jpg">
      </div>
    `
    const { imageUrls } = htmlToText(html)
    expect(imageUrls.filter((u) => u === 'https://img.example.com/a.jpg').length).toBe(1)
  })
})

describe('htmlToText select/nav 등 대용량 노이즈 제거', () => {
  it('select 옵션 목록은 통째로 제거된다', () => {
    const html = `
      <select><option>가나(GHANA)</option><option>대한민국(KOREA)</option></select>
      <p>진짜 본문</p>
    `
    const { text } = htmlToText(html)
    expect(text).not.toContain('GHANA')
    expect(text).toContain('진짜 본문')
  })

  it('nav/header/footer/aside 블록은 제거된다', () => {
    const html = `
      <nav>전역 메뉴</nav>
      <header>헤더 영역</header>
      <aside>사이드바</aside>
      <p>본문 내용</p>
      <footer>회사 정보</footer>
    `
    const { text } = htmlToText(html)
    expect(text).not.toContain('전역 메뉴')
    expect(text).not.toContain('헤더 영역')
    expect(text).not.toContain('사이드바')
    expect(text).not.toContain('회사 정보')
    expect(text).toContain('본문 내용')
  })
})

describe('htmlToText 카페24 실제 fixture (ameaning.co.kr)', () => {
  const fixturePath = join(__dirname, 'fixtures', 'cafe24-product.html')
  const fixtureHtml = readFileSync(fixturePath, 'utf-8')

  it('JSON-LD Product 구조화 데이터를 뽑는다', () => {
    const { structured } = htmlToText(fixtureHtml)
    expect(structured).not.toBeNull()
    expect(structured?.name).toBe('쿨 메쉬 심리스 커버 브라')
    expect(structured?.brand).toBe('에이엠엘 | aml')
    expect(structured?.offers.length).toBeGreaterThan(0)
    expect(structured?.offers[0].name).toContain('쿨 메쉬 심리스 커버 브라')
  })

  it('#prdDetail 안의 지연로딩 상세 이미지(ec-data-src)를 포함하고 small/icon/logo는 제외한다', () => {
    const { imageUrls } = htmlToText(fixtureHtml, undefined, {
      baseUrl: 'https://ameaning.co.kr/product/156/',
    })
    expect(imageUrls.some((u) => u.includes('NNEditor/20260811'))).toBe(true)
    expect(imageUrls.some((u) => /\/small\//i.test(u))).toBe(false)
    expect(imageUrls.some((u) => /icon|logo/i.test(u))).toBe(false)
  })

  it('배송 국가 목록("SHIPPING TO : 가나(GHANA)")이 결과에서 사라진다', () => {
    const { text } = htmlToText(fixtureHtml)
    expect(text).not.toContain('GHANA')
  })

  it('개선 전 대비 결과 텍스트 길이가 유의미하게 줄어든다', () => {
    const { text } = htmlToText(fixtureHtml)
    // 개선 전(구조화/노이즈 제거 적용 전) 이 fixture는 10,977자였다.
    expect(text.length).toBeLessThan(10977 * 0.6)
  })

  it('노이즈 제거가 본문을 죽이지 않는다 — 핵심 상품 정보가 남아있다', () => {
    const { text } = htmlToText(fixtureHtml)
    expect(text).toContain('쿨 메쉬 심리스 커버 브라')
    expect(text).toMatch(/25,?400/)
  })
})
