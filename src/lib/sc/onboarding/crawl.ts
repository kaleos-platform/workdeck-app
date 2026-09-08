import { htmlToText, HTML_TEXT_MAX_CHARS } from '@/lib/sh/html-to-text'
import { safeFetchBinary, safeFetchHtml } from '@/lib/net/safe-fetch'

export const MAX_COLLECTION_RESOURCES = 1000
export const MAX_BLOG_ARTICLES = 20
export const resourceSelect = {
  id: true,
  kind: true,
  sourceUrl: true,
  fileName: true,
  mimeType: true,
  status: true,
  errorMessage: true,
  createdAt: true,
} as const

export type CollectedPage = {
  version: 1
  kind: 'product' | 'catalog' | 'brand' | 'article' | 'document'
  title: string
  text: string
  imageUrls: string[]
  sourceUrl?: string
  warnings?: string[]
}

export function parseCollectedPage(raw: string): CollectedPage | null {
  try {
    const value = JSON.parse(raw)
    if (
      value?.version !== 1 ||
      !['product', 'catalog', 'brand', 'article', 'document'].includes(value.kind) ||
      typeof value.title !== 'string' ||
      typeof value.text !== 'string' ||
      !Array.isArray(value.imageUrls) ||
      !value.imageUrls.every((url: unknown) => typeof url === 'string') ||
      (value.sourceUrl !== undefined && typeof value.sourceUrl !== 'string') ||
      (value.warnings !== undefined &&
        (!Array.isArray(value.warnings) ||
          !value.warnings.every((warning: unknown) => typeof warning === 'string')))
    )
      return null
    return value
  } catch {
    return null
  }
}

function naverBlog(url: URL): { blogId: string; postId?: string } | null {
  if (!['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  const blogId = url.searchParams.get('blogId') || (parts[0]?.includes('.') ? null : parts[0])
  if (!blogId) return null
  const postId =
    url.searchParams.get('logNo') || (/^\d+$/.test(parts[1] ?? '') ? parts[1] : undefined)
  return { blogId, ...(postId ? { postId } : {}) }
}

export function normalizeResourceUrl(raw: string, base?: string): string {
  const url = new URL(raw.replace(/&amp;/g, '&'), base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('올바른 공개 웹 URL이 필요합니다')
  url.hash = ''
  const blog = naverBlog(url)
  if (blog) return `https://m.blog.naver.com/${blog.blogId}${blog.postId ? `/${blog.postId}` : ''}`
  const product =
    url.pathname.match(/^\/product\/[^/]+\/(\d+)(?:\/|$)/)?.[1] ||
    url.searchParams.get('product_no')
  const category =
    url.pathname.match(/^\/category\/[^/]+\/(\d+)(?:\/|$)/)?.[1] || url.searchParams.get('cate_no')
  if (product) {
    url.pathname = '/product/detail.html'
    url.search = new URLSearchParams({ product_no: product }).toString()
  } else if (category) {
    const page = url.searchParams.get('page')
    url.pathname = '/product/list.html'
    url.search = new URLSearchParams({
      cate_no: category,
      ...(page && page !== '1' ? { page } : {}),
    }).toString()
  } else {
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|dclid|msclkid|icid|trackingCode|fromRss)$/i.test(key))
        url.searchParams.delete(key)
    }
    const shopify = url.pathname.match(/\/products\/([^/]+)/)
    if (shopify) {
      url.pathname = `/products/${shopify[1]}`
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, '')
  }
  url.searchParams.sort()
  return url.toString()
}

export function pageKind(url: string): CollectedPage['kind'] {
  const parsed = new URL(url)
  const blog = naverBlog(parsed)
  if (blog) return blog.postId ? 'article' : 'catalog'
  if (
    parsed.searchParams.has('product_no') ||
    /\/(products|product)\/(?!list)/.test(parsed.pathname)
  )
    return 'product'
  if (
    /\/category\/|\/collections(?:\/|$)|\/shop(?:\/|$)|\/products$|\/product\/list/.test(
      parsed.pathname
    )
  )
    return 'catalog'
  return 'brand'
}

export function discoverLinks(html: string, sourceUrl: string): string[] {
  const source = new URL(sourceUrl)
  const blog = naverBlog(source)
  // 글 상세의 추천 글을 따라가며 대표 글 범위를 무한 확장하지 않는다.
  if (blog?.postId) return []
  const links = new Set<string>()
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    try {
      let candidate = new URL(match[1].replace(/&amp;/g, '&'), source)
      if (candidate.hostname.endsWith('.cafe24.com') && candidate.pathname === '/brand/brand.html')
        candidate = new URL(candidate.pathname, source)
      const normalized = normalizeResourceUrl(candidate.toString())
      const next = new URL(normalized)
      if (blog) {
        const targetBlog = naverBlog(next)
        if (
          targetBlog?.blogId === blog.blogId &&
          targetBlog.postId &&
          links.size < MAX_BLOG_ARTICLES
        )
          links.add(normalized)
      } else if (
        next.hostname.replace(/^www\./, '') === source.hostname.replace(/^www\./, '') &&
        !/recent_view|search|basket|wish/i.test(next.pathname) &&
        /\/(?:product|products|category|collections|shop|brand|about)(?:\/|\.|$)/i.test(
          next.pathname
        )
      ) {
        // www 유무와 프로토콜 차이로 동일 페이지가 중복 등록되지 않도록 한다.
        next.host = source.host
        next.protocol = source.protocol
        if (next.toString() !== normalizeResourceUrl(sourceUrl)) links.add(next.toString())
      }
    } catch {
      /* 잘못된 링크와 javascript URL은 수집하지 않는다. */
    }
  }
  // 초기 상태는 blogId가 명시된 객체만 사용해 다른 블로그의 추천 글을 제외한다.
  if (blog) {
    const state = html.replace(/\\"/g, '"')
    for (const match of state.matchAll(/\{[^{}]*["']logNo["']\s*:\s*["']?\d+[^{}]*\}/g)) {
      if (links.size >= MAX_BLOG_ARTICLES) break
      const id = match[0].match(/["']blogId["']\s*:\s*["']([^"']+)["']/)?.[1]
      const postId = match[0].match(/["']logNo["']\s*:\s*["']?(\d+)/)?.[1]
      if (id === blog.blogId && postId)
        links.add(`https://m.blog.naver.com/${blog.blogId}/${postId}`)
    }
  }
  return [...links]
}

export async function collectPage(
  sourceUrl: string
): Promise<{ page: CollectedPage; links: string[] }> {
  const fetched = await safeFetchHtml(sourceUrl)
  if (fetched.truncated)
    throw new Error(
      '페이지가 수집 용량 한도를 초과해 전체 상품 수집을 확인할 수 없습니다. 개별 카테고리 또는 상품 URL을 추가해 주세요.'
    )
  const extracted = htmlToText(fetched.html, HTML_TEXT_MAX_CHARS, {
    baseUrl: fetched.finalUrl,
    maxImageUrls: 100,
    detailImagesOnly: true,
  })
  if (!extracted.text.trim() && !extracted.imageUrls.length)
    throw new Error('페이지에서 텍스트와 이미지를 추출하지 못했습니다')
  let links = discoverLinks(fetched.html, fetched.finalUrl)
  const blog = naverBlog(new URL(fetched.finalUrl))
  if (blog && !blog.postId && !links.length) {
    const rss = await safeFetchBinary(
      `https://rss.blog.naver.com/${encodeURIComponent(blog.blogId)}.xml`,
      {
        maxBytes: 2 * 1024 * 1024,
        allowedMimePrefixes: ['application/rss+xml', 'application/xml', 'text/xml', 'text/plain'],
      }
    )
    links = discoverRssLinks(rss.bytes.toString('utf8'), fetched.finalUrl)
    if (!links.length)
      throw new Error('블로그 목록에서 글을 찾지 못했습니다. 공개된 개별 글 URL을 추가해 주세요.')
  }
  return {
    page: {
      version: 1,
      kind: pageKind(fetched.finalUrl),
      title: extracted.title || sourceUrl,
      text: extracted.text,
      imageUrls: extracted.imageUrls,
      sourceUrl,
      ...(extracted.imageUrlsTruncated
        ? { warnings: ['상세 이미지가 100개를 초과해 일부는 분석하지 못했습니다'] }
        : {}),
    },
    links,
  }
}

export function discoverRssLinks(xml: string, sourceUrl: string): string[] {
  const links = [...xml.matchAll(/<link>\s*(?:<!\[CDATA\[)?(https?:\/\/[^<\]]+)/g)]
    .map((match) => `<a href="${match[1].trim()}"></a>`)
    .join('')
  return discoverLinks(links, sourceUrl)
}
