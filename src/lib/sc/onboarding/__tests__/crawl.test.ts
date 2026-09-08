import {
  collectPage,
  discoverLinks,
  discoverRssLinks,
  normalizeResourceUrl,
  parseCollectedPage,
} from '../crawl'
import { extractTextFromFile, resourceMimeType } from '../extract'
import { safeFetchHtml } from '@/lib/net/safe-fetch'

jest.mock('@/lib/net/safe-fetch', () => ({ safeFetchHtml: jest.fn(), safeFetchBinary: jest.fn() }))

test('Cafe24 상품과 카테고리 변형을 정규화하고 페이지는 보존한다', () => {
  expect(
    normalizeResourceUrl('https://meaninglab.co.kr/product/name/62/category/24/?utm_source=x')
  ).toBe('https://meaninglab.co.kr/product/detail.html?product_no=62')
  expect(normalizeResourceUrl('https://meaninglab.co.kr/category/name/24/?page=2')).toBe(
    'https://meaninglab.co.kr/product/list.html?cate_no=24&page=2'
  )
})

test('모든 상품과 페이지 링크를 발견하되 외부 사이트와 장바구니를 제외한다', () => {
  const html =
    Array.from(
      { length: 25 },
      (_, i) => `<a href="/product/name/${i + 1}/category/24/">상품</a>`
    ).join('') +
    '<a href="/product/list.html?cate_no=24&amp;page=2">다음</a><a href="https://other.com/products/a">외부</a><a href="/order/basket.html">장바구니</a>'
  expect(discoverLinks(html, 'https://meaninglab.co.kr/')).toHaveLength(26)
})

test('Naver는 동일 블로그 글만 대표 20건 수집한다', () => {
  const html =
    '<a href="https://blog.naver.com/other/1234">외부</a>' +
    Array.from(
      { length: 30 },
      (_, i) => `<a href="https://blog.naver.com/meaning-lab/${1000 + i}">글</a>`
    ).join('')
  const links = discoverLinks(html, 'https://m.blog.naver.com/meaning-lab')
  expect(links).toHaveLength(20)
  expect(links[0]).toBe('https://m.blog.naver.com/meaning-lab/1000')
})

test('Markdown MIME 추론과 envelope 검증', async () => {
  expect(resourceMimeType('', 'company.md')).toBe('text/markdown')
  expect(await extractTextFromFile(Buffer.from('# 회사\n\n제품 소개'), 'text/markdown')).toContain(
    '제품 소개'
  )
  expect(parseCollectedPage('legacy plain text')).toBeNull()
  expect(parseCollectedPage('{"version":1,"kind":"product"}')).toBeNull()
})

test('실제 Naver RSS의 CDATA 링크를 같은 블로그 글로 정규화한다', () => {
  const rss =
    '<channel><link><![CDATA[https://blog.naver.com/meaning-lab?fromRss=true&trackingCode=rss]]></link><item><link><![CDATA[https://blog.naver.com/meaning-lab/224392074714?fromRss=true&trackingCode=rss]]></link></item></channel>'
  expect(discoverRssLinks(rss, 'https://m.blog.naver.com/meaning-lab')).toEqual([
    'https://m.blog.naver.com/meaning-lab/224392074714',
  ])
})

test('카테고리 자기 링크는 제외하고 다음 페이지를 수집한다', () => {
  expect(
    discoverLinks(
      '<a href="/category/test/47/?page=1">1</a><a href="?cate_no=47&page=2">2</a>',
      'https://meaninglab.co.kr/product/list.html?cate_no=47'
    )
  ).toEqual(['https://meaninglab.co.kr/product/list.html?cate_no=47&page=2'])
})

test('리다이렉트 최종 호스트와 경로로 링크를 해석하되 원본 출처는 유지한다', async () => {
  jest.mocked(safeFetchHtml).mockResolvedValueOnce({
    finalUrl: 'https://shop.example.com/shop/',
    html: '<p>카탈로그</p><a href="product/widget">상품</a>',
    truncated: false,
  })
  const result = await collectPage('https://example.com/store')
  expect(result.links).toEqual(['https://shop.example.com/shop/product/widget'])
  expect(result.page.sourceUrl).toBe('https://example.com/store')
})

test('HTML 용량 한도로 잘린 응답은 전체 상품 수집 완료로 처리하지 않는다', async () => {
  jest.mocked(safeFetchHtml).mockResolvedValueOnce({
    finalUrl: 'https://example.com/',
    html: '<p>일부 상품</p>',
    truncated: true,
  })
  await expect(collectPage('https://example.com/')).rejects.toThrow(
    '전체 상품 수집을 확인할 수 없습니다'
  )
})

test('텍스트가 없는 이미지 상세페이지도 수집한다', async () => {
  jest.mocked(safeFetchHtml).mockResolvedValueOnce({
    finalUrl: 'https://example.com/products/widget',
    html: '<div id="prdDetail"><img src="https://example.com/detail.jpg"></div>',
    truncated: false,
  })
  const result = await collectPage('https://example.com/products/widget')
  expect(result.page.text).toBe('')
  expect(result.page.imageUrls).toEqual(['https://example.com/detail.jpg'])
})

test('알 수 없는 상품 식별 쿼리는 보존하고 알려진 추적 쿼리만 제거한다', () => {
  expect(
    normalizeResourceUrl(
      'https://shop.example.com/product/detail?id=62&utm_source=test&gclid=tracking'
    )
  ).toBe('https://shop.example.com/product/detail?id=62')
  expect(normalizeResourceUrl('https://shop.example.com/product/detail?id=63')).not.toBe(
    normalizeResourceUrl('https://shop.example.com/product/detail?id=62')
  )
  expect(
    normalizeResourceUrl('https://shop.example.com/products/widget?lang=ko&utm_campaign=test')
  ).toBe('https://shop.example.com/products/widget?lang=ko')
})

test('긴 Markdown은 줄바꿈을 보존하고 미분석 구간을 명시한다', async () => {
  const result = await extractTextFromFile(
    Buffer.from('# 소개\n\n' + '가'.repeat(20_100)),
    'text/markdown'
  )
  expect(result).toContain('# 소개\n\n')
  expect(result).toMatch(/\[자료 길이 제한으로 이후 내용 미분석\]$/)
})
