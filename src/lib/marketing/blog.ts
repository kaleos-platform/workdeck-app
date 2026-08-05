/**
 * 마케팅 블로그 — content/blog/*.mdx 파일을 읽어 포스트 목록/상세를 제공한다.
 * fs 기반이므로 서버 전용(빌드/서버 컴포넌트)에서만 호출한다.
 */
import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type { MarketingDeckSlug } from './types'

const BLOG_CONTENT_DIR = path.join(process.cwd(), 'content', 'blog')

export interface BlogPostFrontmatter {
  title: string
  description: string
  /** YYYY-MM-DD */
  date: string
  tags: string[]
  /** 연관 deck 랜딩 (없으면 브랜드 홈 관련 포스트) */
  deck?: MarketingDeckSlug
}

export interface BlogPost extends BlogPostFrontmatter {
  slug: string
  content: string
}

function readMdxFilenames(): string[] {
  if (!fs.existsSync(BLOG_CONTENT_DIR)) {
    return []
  }
  return fs.readdirSync(BLOG_CONTENT_DIR).filter((filename) => filename.endsWith('.mdx'))
}

function parseFrontmatter(raw: Record<string, unknown>): BlogPostFrontmatter {
  return {
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    date: String(raw.date ?? ''),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    deck: typeof raw.deck === 'string' ? (raw.deck as MarketingDeckSlug) : undefined,
  }
}

/** 전체 포스트 목록 — date desc 정렬. content/blog가 없거나 비어도 안전하게 [] 반환 */
export function getAllPosts(): BlogPost[] {
  const filenames = readMdxFilenames()

  const posts = filenames.map((filename) => {
    const slug = filename.replace(/\.mdx$/, '')
    const fullPath = path.join(BLOG_CONTENT_DIR, filename)
    const source = fs.readFileSync(fullPath, 'utf-8')
    const { data, content } = matter(source)

    return {
      slug,
      content,
      ...parseFrontmatter(data),
    }
  })

  return posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/** slug 단건 조회 — 없으면 undefined */
export function getPost(slug: string): BlogPost | undefined {
  return getAllPosts().find((post) => post.slug === slug)
}

/** sitemap.ts 등 슬러그만 필요한 호출부용 — 기존 스텁 시그니처 유지 */
export function getAllPostSlugs(): string[] {
  return getAllPosts().map((post) => post.slug)
}
